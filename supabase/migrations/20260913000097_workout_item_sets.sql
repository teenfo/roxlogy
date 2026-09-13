-- ============================================================
-- Roxlogy — WOD 세트별 기록
--
-- 지금까지 한 종목의 수행 기록은 workout_item_completions 한 행(무게·횟수 각 1칸)뿐이었다.
-- "스쿼트 3세트"를 해도 칸이 하나라, 실제로 몇 개를 했는지 합산할 수 없었다
-- (1세트 12회·2세트 10회·3세트 8회 = 30회를 한 칸에 어떻게 적든 집계가 안 된다).
--
-- workout_item_sets: 종목 하나에 세트 행을 여러 개 둔다. 횟수·무게·거리·시간을 세트마다
-- 따로 적고, 합계는 읽는 쪽에서 더한다.
--
-- 완료 판정(workout_item_completions)은 그대로 둔다 — 일정·대시보드의 "WOD 완료"가 그걸 본다.
-- 세트를 하나라도 적으면 트리거가 완료 행을 만들어 준다(클라이언트가 빠뜨려도 어긋나지 않게).
-- ============================================================

create table if not exists public.workout_item_sets (
  id          uuid primary key default gen_random_uuid(),
  -- 삽입 시 클라이언트가 user_id 를 보내지 않아도 되도록(완료 테이블과 같은 방식)
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id     uuid not null references public.workout_template_items(id) on delete cascade,
  set_no      smallint not null check (set_no between 1 and 50),
  reps        integer  check (reps between 0 and 10000),
  weight_kg   numeric(6,2) check (weight_kg between 0 and 1000),
  distance_m  integer  check (distance_m between 0 and 200000),
  duration_s  integer  check (duration_s between 0 and 86400),
  note        text     check (char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, item_id, set_no)
);

comment on table public.workout_item_sets is
  'WOD 종목의 세트별 수행 기록. 한 종목에 세트 행이 여러 개 — 합계는 읽는 쪽에서 더한다.';

create index if not exists idx_wis_item on public.workout_item_sets(item_id);
create index if not exists idx_wis_user_item on public.workout_item_sets(user_id, item_id, set_no);

drop trigger if exists workout_item_sets_touch on public.workout_item_sets;
create trigger workout_item_sets_touch
  before update on public.workout_item_sets
  for each row execute function public.set_updated_at();

alter table public.workout_item_sets enable row level security;

-- 본인 기록만. 명령별로 정책 하나씩(CLAUDE.md).
drop policy if exists wis_select_own on public.workout_item_sets;
create policy wis_select_own on public.workout_item_sets
  for select using (user_id = auth.uid());
drop policy if exists wis_insert_own on public.workout_item_sets;
create policy wis_insert_own on public.workout_item_sets
  for insert with check (user_id = auth.uid());
drop policy if exists wis_update_own on public.workout_item_sets;
create policy wis_update_own on public.workout_item_sets
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists wis_delete_own on public.workout_item_sets;
create policy wis_delete_own on public.workout_item_sets
  for delete using (user_id = auth.uid());

grant select, insert, update, delete on public.workout_item_sets to authenticated;

-- 세트를 적으면 그 종목은 수행한 것 — 완료 행을 만들어 준다(이미 있으면 그대로).
create or replace function public.wis_mark_item_done()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into workout_item_completions (user_id, item_id)
  values (new.user_id, new.item_id)
  on conflict (user_id, item_id) do nothing;
  return new;
end; $$;
revoke all on function public.wis_mark_item_done() from public, anon, authenticated;

drop trigger if exists workout_item_sets_mark_done on public.workout_item_sets;
create trigger workout_item_sets_mark_done
  after insert on public.workout_item_sets
  for each row execute function public.wis_mark_item_done();

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_user uuid; v_item uuid; v_n int; v_reps int;
begin
  select id into v_user from public.profiles where not disabled limit 1;
  select i.id into v_item from public.workout_template_items i limit 1;
  if v_user is null or v_item is null then raise notice '가드 건너뜀: 데이터 부족'; return; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);

  -- 한 종목에 세트 3개
  insert into public.workout_item_sets (user_id, item_id, set_no, reps, weight_kg)
  values (v_user, v_item, 1, 12, 60), (v_user, v_item, 2, 10, 60), (v_user, v_item, 3, 8, 62.5);
  select count(*), sum(reps) into v_n, v_reps
    from public.workout_item_sets where user_id = v_user and item_id = v_item;
  if v_n <> 3 or v_reps <> 30 then
    raise exception '가드: 세트 합산 이상 (행 %, 합 %)', v_n, v_reps; end if;

  -- 같은 세트 번호는 한 번만
  begin
    insert into public.workout_item_sets (user_id, item_id, set_no, reps)
    values (v_user, v_item, 2, 5);
    raise exception '가드: 같은 세트 번호가 중복 저장됐다';
  exception when unique_violation then null;
  end;

  -- 세트를 적으면 완료 행이 생긴다
  perform 1 from public.workout_item_completions
   where user_id = v_user and item_id = v_item;
  if not found then raise exception '가드: 세트를 적었는데 완료 행이 없다'; end if;

  -- 범위 밖 값은 거부
  begin
    insert into public.workout_item_sets (user_id, item_id, set_no, reps)
    values (v_user, v_item, 9, -1);
    raise exception '가드: 음수 횟수가 저장됐다';
  exception when check_violation then null;
  end;

  perform set_config('request.jwt.claims', '', true);
  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
