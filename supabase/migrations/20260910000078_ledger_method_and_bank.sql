-- 회계: 결제 수단 · 통장 반영일 · 통장 기초 잔액.
--
-- 장부(crew_ledger)는 "언제 쓴 돈인가"(entry_date)만 갖고 있었다. 실제 통장에
-- 언제 찍혔는지, 카드인지 현금인지가 없어 통장과 대사할 수가 없다.
--   · method     — 현금·카드·이체·기타 (미지정 허용: 과거 기록을 강제로 채우지 않는다)
--   · settled_on — 통장에 반영된 날. 비어 있으면 아직 통장에 안 찍힌 것.
-- 컬럼 추가라 옛 번들이 무시하고 지나간다 — 배포 순서와 무관하다.
alter table public.crew_ledger
  add column if not exists method text,
  add column if not exists settled_on date;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'crew_ledger_method_check'
  ) then
    alter table public.crew_ledger
      add constraint crew_ledger_method_check
      check (method is null or method in ('cash', 'card', 'transfer', 'other'));
  end if;
end $$;

-- 통장 잔고를 계산하려면 시작점이 필요하다. crews 에 두면 안 된다 —
-- crews 는 익명도 select 할 수 있어(공개 크루 목록·검색) 잔액이 새어 나간다.
-- 회계와 같은 가시성(정회원)을 가진 별도 테이블에 둔다.
create table if not exists public.crew_bank (
  crew_id uuid primary key references public.crews(id) on delete cascade,
  opening_balance bigint not null default 0,
  opening_on date,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.crew_bank enable row level security;

drop policy if exists crew_bank_select on public.crew_bank;
create policy crew_bank_select on public.crew_bank for select
  using (is_crew_full_member(crew_id) or (select is_admin()));

drop policy if exists crew_bank_insert on public.crew_bank;
create policy crew_bank_insert on public.crew_bank for insert
  with check (is_crew_staff(crew_id));

drop policy if exists crew_bank_update on public.crew_bank;
create policy crew_bank_update on public.crew_bank for update
  using (is_crew_staff(crew_id))
  with check (is_crew_staff(crew_id));

-- 검증 — 크루 밖 사람은 기초 잔액을 볼 수 없다
do $$
declare
  v_crew uuid;
  v_out uuid;
  v_n int;
begin
  select id into v_crew from crews where status = 'active' limit 1;
  if v_crew is null then
    raise notice 'no crew — skipping guard';
    return;
  end if;
  insert into crew_bank (crew_id, opening_balance)
       values (v_crew, 123456)
  on conflict (crew_id) do nothing;

  select p.id into v_out from profiles p
   where not exists (select 1 from crew_members m
                      where m.crew_id = v_crew and m.user_id = p.id
                        and m.status = 'active')
     and not coalesce(p.is_admin, false)
   limit 1;
  if v_out is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_out::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n from crew_bank where crew_id = v_crew;
    reset role;
    if v_n <> 0 then raise exception 'outsider sees crew_bank'; end if;
  end if;

  perform set_config('request.jwt.claims', null, true);
  raise exception '__guard_rollback__';
exception when others then
  begin reset role; exception when others then null; end;
  if sqlerrm <> '__guard_rollback__' then raise; end if;
end $$;
