-- ============================================================
-- Roxlogy — 크루 장부에 지출/수입 카테고리
--
-- 회계 시안의 "이 달 지출 구성" 바를 그리려면 거래를 묶을 축이 필요한데
-- crew_ledger 에는 종류(수입/지출)밖에 없었다. 그래서 nullable 카테고리를
-- 더한다. **덧붙이기만 하는 변경**이라 옛 번들이 무시하고 지나간다
-- (CLAUDE.md: RPC·컬럼 변경은 배포와 원자적이지 않다).
--
-- 값은 영어 키로 저장하고 화면에서 번역한다 — 크루가 쓰는 언어가 섞여도
-- 집계가 갈라지지 않는다. 종류마다 쓸 수 있는 키가 달라서 짝까지 검사한다:
-- 지출 행에 '회비'가 붙거나 수입 행에 '장소 대여'가 붙으면 그건 입력 실수다.
--
-- 기존 행은 전부 null 로 남는다. 회비 확정으로 생긴 행(source = 'dues')은
-- 화면에서 'dues' 로 취급하므로 굳이 채우지 않는다 — 카테고리 컬럼은
-- "사람이 고른 값"이라는 뜻을 유지한다.
-- ============================================================

alter table public.crew_ledger
  add column if not exists category text;

alter table public.crew_ledger
  drop constraint if exists crew_ledger_category_kind_ck;

alter table public.crew_ledger
  add constraint crew_ledger_category_kind_ck check (
    category is null
    or (kind = 'income' and category in ('dues', 'sponsor', 'carryover'))
    or (kind = 'expense' and category in ('venue', 'snack', 'gear', 'race', 'other'))
  );

comment on column public.crew_ledger.category is
  '거래 분류(영어 키, 화면에서 번역). 수입: dues·sponsor·carryover / 지출: venue·snack·gear·race·other. null = 미분류.';

-- 지출 구성 바는 crew_id + 기간 + 지출만 훑는다. 기존 (crew_id, entry_date desc)
-- 인덱스로 충분해서 새 인덱스는 만들지 않는다 (CLAUDE.md: 만들기 전에 같은 게
-- 있는지 확인).

-- ---------- 마감 잠금에 category 를 포함 ---------------------------------
-- 마감된 달의 장부 행은 통장 반영일(settled_on)만 고칠 수 있다. 그 판정은
-- 컬럼을 손으로 나열한 튜플 비교라, 새 컬럼은 적어 주지 않으면 마감된 달에도
-- 조용히 바뀐다. 카테고리를 그 목록에 넣는다.
create or replace function public.rox_ledger_month_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' then
    if is_month_closed(old.crew_id, to_char(old.entry_date, 'YYYY-MM'))
       or is_month_closed(new.crew_id, to_char(new.entry_date, 'YYYY-MM')) then
      if (new.crew_id, new.entry_date, new.kind, new.amount,
          new.title, new.memo, new.source, new.method, new.category)
         is distinct from
         (old.crew_id, old.entry_date, old.kind, old.amount,
          old.title, old.memo, old.source, old.method, old.category) then
        raise exception 'ledger_month_closed';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if is_month_closed(old.crew_id, to_char(old.entry_date, 'YYYY-MM')) then
      raise exception 'ledger_month_closed';
    end if;
    return old;
  end if;

  if is_month_closed(new.crew_id, to_char(new.entry_date, 'YYYY-MM')) then
    raise exception 'ledger_month_closed';
  end if;
  return new;
end $$;

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_crew uuid;
  v_user uuid;
  v_id uuid;
  v_ok boolean;
begin
  -- 컬럼이 붙었나
  perform 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'crew_ledger' and column_name = 'category';
  if not found then raise exception '가드: category 컬럼이 없다'; end if;

  -- 이 달이 마감된 크루를 고르면 장부 잠금 트리거에 막힌다
  select c.id into v_crew
    from public.crews c
   where not public.is_month_closed(c.id, to_char(current_date, 'YYYY-MM'))
   limit 1;
  if v_crew is null then
    raise notice '가드: 쓸 수 있는 크루가 없어 제약 검사를 건너뛴다';
    return;
  end if;
  select created_by into v_user from public.crew_ledger where crew_id = v_crew limit 1;

  -- 1) 짝이 맞는 값은 들어간다
  insert into public.crew_ledger (crew_id, entry_date, kind, amount, title, category, created_by)
  values (v_crew, current_date, 'expense', 1, '__guard__', 'venue', v_user)
  returning id into v_id;

  -- 2) 종류가 어긋나면 막힌다 (지출 행에 수입 카테고리)
  v_ok := false;
  begin
    update public.crew_ledger set category = 'dues' where id = v_id;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then raise exception '가드: 지출 행에 수입 카테고리가 들어갔다'; end if;

  -- 3) 모르는 값도 막힌다
  v_ok := false;
  begin
    update public.crew_ledger set category = 'lunch' where id = v_id;
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then raise exception '가드: 정의되지 않은 카테고리가 들어갔다'; end if;

  -- 4) null 은 언제나 허용 (옛 행)
  update public.crew_ledger set category = null where id = v_id;

  delete from public.crew_ledger where id = v_id;
end $$;
