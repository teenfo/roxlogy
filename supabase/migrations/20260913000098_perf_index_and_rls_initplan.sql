-- ============================================================
-- Roxlogy — 성능 정리: 중복 인덱스 제거 + RLS initplan 래핑
--
-- 둘 다 지금 병목은 아니다(데이터가 적다). 트래픽이 붙기 전에 싸게 치워 둔다.
--
-- 1) notifications 에 완전히 동일한 인덱스가 두 개 있다.
--    - notifications_user_created_idx  (20260716000001_push_notifications.sql)
--    - idx_notifications_user_created  (20260910000083_notifications_delete.sql)
--    정의가 (user_id, created_at desc) 로 같다. 쓰기마다 두 번 갱신되고 용량만 두 배다.
--    뒤에 생긴 083 쪽을 지운다 — 새 DB 에 마이그레이션을 처음부터 재생해도
--    083 이 만든 뒤 이 파일이 지우므로 최종 상태가 같다(두 옛 파일은 건드리지 않는다).
--
-- 2) RLS 정책의 auth.uid() 를 (select auth.uid()) 로 감싼다.
--    감싸지 않으면 행마다 함수가 호출된다. 서브쿼리로 감싸면 initplan 으로 한 번만
--    평가된다(CLAUDE.md 의 is_admin() 규칙과 같은 이유). 판정 결과는 동일하다.
--    대상: workout_item_sets 4건(097 에서 만들 때 빠뜨림), crew_month_close 1건.
-- ============================================================

drop index if exists public.idx_notifications_user_created;

-- workout_item_sets — 정책 이름·명령·의미 그대로, initplan 래핑만 추가
drop policy if exists wis_select_own on public.workout_item_sets;
create policy wis_select_own on public.workout_item_sets
  for select using (user_id = (select auth.uid()));

drop policy if exists wis_insert_own on public.workout_item_sets;
create policy wis_insert_own on public.workout_item_sets
  for insert with check (user_id = (select auth.uid()));

drop policy if exists wis_update_own on public.workout_item_sets;
create policy wis_update_own on public.workout_item_sets
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists wis_delete_own on public.workout_item_sets;
create policy wis_delete_own on public.workout_item_sets
  for delete using (user_id = (select auth.uid()));

-- crew_month_close — insert 정책의 closed_by 판정만 래핑(나머지는 이미 감싸져 있다)
drop policy if exists crew_month_close_insert on public.crew_month_close;
create policy crew_month_close_insert on public.crew_month_close
  for insert with check (
    (select is_crew_staff(crew_id)) and closed_by = (select auth.uid())
  );

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_me uuid; v_other uuid; v_item uuid; v_seen int; v_dupe int;
begin
  -- 중복 인덱스가 정말 하나만 남았는지
  select count(*) into v_dupe from pg_indexes
   where schemaname='public' and tablename='notifications'
     and indexdef like '%(user_id, created_at DESC)%';
  if v_dupe <> 1 then
    raise exception '가드: notifications 의 (user_id, created_at desc) 인덱스가 %개', v_dupe;
  end if;

  select id into v_me from public.profiles where not disabled order by id limit 1;
  select id into v_other from public.profiles where not disabled and id <> v_me order by id limit 1;
  select i.id into v_item from public.workout_template_items i limit 1;
  if v_me is null or v_other is null or v_item is null then
    raise notice '가드 건너뜀: 데이터 부족'; return;
  end if;

  -- 내 세트를 하나 만들고
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_me::text, 'role', 'authenticated')::text, true);
  insert into public.workout_item_sets (user_id, item_id, set_no, reps)
  values (v_me, v_item, 1, 10);

  -- 남이 보지 못하는지 (래핑 후에도 격리가 유지되는가)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from public.workout_item_sets where item_id = v_item;
  reset role;
  if v_seen <> 0 then
    raise exception '가드: 남의 세트가 %건 보인다', v_seen;
  end if;

  -- 본인은 보이는지
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_me::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from public.workout_item_sets where item_id = v_item;
  reset role;
  if v_seen <> 1 then
    raise exception '가드: 내 세트가 안 보인다 (%건)', v_seen;
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
