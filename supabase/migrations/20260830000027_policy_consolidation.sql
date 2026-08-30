-- Roxlogy — 중복 permissive 정책 정리 (advisor: multiple_permissive_policies 95건)
--
-- 두 가지 패턴만 있다. 어느 쪽도 접근 범위를 바꾸지 않는다.
--
--  (A) `for all` 쓰기 정책이 SELECT 에도 permissive 분기를 하나 더 만든다.
--      쓰기 정책의 USING 은 항상 해당 테이블 SELECT 정책의 부분집합이므로
--      (본인 소유 ⊂ 본인 소유+공개, 스태프 ⊂ 멤버, 관리자 ⊂ 로그인),
--      insert/update/delete 로 쪼개면 읽기 권한은 그대로고 SELECT 분기만 사라진다.
--      UPDATE ... RETURNING / ON CONFLICT DO UPDATE 가 요구하는 행 가시성도
--      기존 SELECT 정책이 그대로 커버한다.
--
--  (B) 같은 명령에 정책이 2~3개로 쪼개져 있다(본인·공유·관리자).
--      OR 로 합치면 동치다 — permissive 정책들은 어차피 OR 로 평가된다.
--
-- 효과: 모든 쿼리에서 정책 분기 수가 줄어 RLS 평가 비용이 내려간다.
--
-- 덤: 행마다 호출되던 is_admin() 을 (select is_admin()) 으로 감싸 initplan 으로
-- 한 번만 평가되게 했다(auth.uid() 와 같은 최적화, 20260830000018).

-- ─────────────────────────────────────────── (A) for all → insert/update/delete

-- crew_events: 스태프 ⊂ 멤버(=select 대상)
drop policy if exists crew_events_write_staff on public.crew_events;
create policy crew_events_insert_staff on public.crew_events
  for insert with check (is_crew_staff(crew_id) or (select is_admin()));
create policy crew_events_update_staff on public.crew_events
  for update using (is_crew_staff(crew_id) or (select is_admin()))
             with check (is_crew_staff(crew_id) or (select is_admin()));
create policy crew_events_delete_staff on public.crew_events
  for delete using (is_crew_staff(crew_id) or (select is_admin()));

-- crew_program_enrollments: 스태프 ⊂ 멤버
drop policy if exists crew_prog_write_staff on public.crew_program_enrollments;
create policy crew_prog_insert_staff on public.crew_program_enrollments
  for insert with check (is_crew_staff(crew_id));
create policy crew_prog_update_staff on public.crew_program_enrollments
  for update using (is_crew_staff(crew_id)) with check (is_crew_staff(crew_id));
create policy crew_prog_delete_staff on public.crew_program_enrollments
  for delete using (is_crew_staff(crew_id));

-- erg_samples: 쓰기 USING 과 select USING 이 동일
drop policy if exists erg_samples_write_own on public.erg_samples;
create policy erg_samples_insert_own on public.erg_samples
  for insert with check (exists (
    select 1 from session_segments seg join sessions s on s.id = seg.session_id
    where seg.id = erg_samples.segment_id and s.user_id = (select auth.uid())));
create policy erg_samples_update_own on public.erg_samples
  for update using (exists (
    select 1 from session_segments seg join sessions s on s.id = seg.session_id
    where seg.id = erg_samples.segment_id and s.user_id = (select auth.uid())))
  with check (exists (
    select 1 from session_segments seg join sessions s on s.id = seg.session_id
    where seg.id = erg_samples.segment_id and s.user_id = (select auth.uid())));
create policy erg_samples_delete_own on public.erg_samples
  for delete using (exists (
    select 1 from session_segments seg join sessions s on s.id = seg.session_id
    where seg.id = erg_samples.segment_id and s.user_id = (select auth.uid())));

-- exercises: 관리자 ⊂ 로그인 사용자(=select 대상)
drop policy if exists exercises_admin_write on public.exercises;
create policy exercises_admin_insert on public.exercises
  for insert with check ((select is_admin()));
create policy exercises_admin_update on public.exercises
  for update using ((select is_admin())) with check ((select is_admin()));
create policy exercises_admin_delete on public.exercises
  for delete using ((select is_admin()));

-- program_days: 소유자 ⊂ 공개+소유자
drop policy if exists program_days_write on public.program_days;
create policy program_days_insert on public.program_days
  for insert with check (exists (
    select 1 from programs p
    where p.id = program_days.program_id and p.owner_id = (select auth.uid())));
create policy program_days_update on public.program_days
  for update using (exists (
    select 1 from programs p
    where p.id = program_days.program_id and p.owner_id = (select auth.uid())))
  with check (exists (
    select 1 from programs p
    where p.id = program_days.program_id and p.owner_id = (select auth.uid())));
create policy program_days_delete on public.program_days
  for delete using (exists (
    select 1 from programs p
    where p.id = program_days.program_id and p.owner_id = (select auth.uid())));

-- session_segments: 소유자 ⊂ 소유자+공유
drop policy if exists segments_write_own on public.session_segments;
create policy segments_insert_own on public.session_segments
  for insert with check (exists (
    select 1 from sessions s
    where s.id = session_segments.session_id and s.user_id = (select auth.uid())));
create policy segments_update_own on public.session_segments
  for update using (exists (
    select 1 from sessions s
    where s.id = session_segments.session_id and s.user_id = (select auth.uid())))
  with check (exists (
    select 1 from sessions s
    where s.id = session_segments.session_id and s.user_id = (select auth.uid())));
create policy segments_delete_own on public.session_segments
  for delete using (exists (
    select 1 from sessions s
    where s.id = session_segments.session_id and s.user_id = (select auth.uid())));

-- workout_templates: 소유자 ⊂ 공개+소유자
drop policy if exists workout_templates_write on public.workout_templates;
create policy workout_templates_insert on public.workout_templates
  for insert with check (exists (
    select 1 from program_days d join programs p on p.id = d.program_id
    where d.id = workout_templates.program_day_id and p.owner_id = (select auth.uid())));
create policy workout_templates_update on public.workout_templates
  for update using (exists (
    select 1 from program_days d join programs p on p.id = d.program_id
    where d.id = workout_templates.program_day_id and p.owner_id = (select auth.uid())))
  with check (exists (
    select 1 from program_days d join programs p on p.id = d.program_id
    where d.id = workout_templates.program_day_id and p.owner_id = (select auth.uid())));
create policy workout_templates_delete on public.workout_templates
  for delete using (exists (
    select 1 from program_days d join programs p on p.id = d.program_id
    where d.id = workout_templates.program_day_id and p.owner_id = (select auth.uid())));

-- workout_template_items: 소유자 ⊂ 공개+소유자
drop policy if exists workout_template_items_write on public.workout_template_items;
create policy workout_template_items_insert on public.workout_template_items
  for insert with check (exists (
    select 1 from workout_templates t
      join program_days d on d.id = t.program_day_id
      join programs p on p.id = d.program_id
    where t.id = workout_template_items.template_id and p.owner_id = (select auth.uid())));
create policy workout_template_items_update on public.workout_template_items
  for update using (exists (
    select 1 from workout_templates t
      join program_days d on d.id = t.program_day_id
      join programs p on p.id = d.program_id
    where t.id = workout_template_items.template_id and p.owner_id = (select auth.uid())))
  with check (exists (
    select 1 from workout_templates t
      join program_days d on d.id = t.program_day_id
      join programs p on p.id = d.program_id
    where t.id = workout_template_items.template_id and p.owner_id = (select auth.uid())));
create policy workout_template_items_delete on public.workout_template_items
  for delete using (exists (
    select 1 from workout_templates t
      join program_days d on d.id = t.program_day_id
      join programs p on p.id = d.program_id
    where t.id = workout_template_items.template_id and p.owner_id = (select auth.uid())));

-- race_results: for all 분해 + 관리자 정책 흡수
drop policy if exists race_results_write_own on public.race_results;
drop policy if exists race_results_admin_delete on public.race_results;
create policy race_results_insert_own on public.race_results
  for insert with check (user_id = (select auth.uid()));
create policy race_results_update_own on public.race_results
  for update using (user_id = (select auth.uid()))
             with check (user_id = (select auth.uid()));
create policy race_results_delete on public.race_results
  for delete using (user_id = (select auth.uid()) or (select is_admin()));

-- ─────────────────────────────────────────── (B) 같은 명령의 정책 OR 병합

-- profiles: select 2 → 1, update 2 → 1
drop policy if exists profiles_admin_select on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select on public.profiles
  for select using ((select auth.uid()) = id or (select is_admin()));
drop policy if exists profiles_admin_update on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update on public.profiles
  for update using ((select auth.uid()) = id or (select is_admin()))
             with check ((select auth.uid()) = id or (select is_admin()));

-- programs: select 2 → 1, update 2 → 1, delete 2 → 1
drop policy if exists programs_admin_select on public.programs;
drop policy if exists programs_select_public_or_own on public.programs;
create policy programs_select on public.programs
  for select using (is_public or owner_id = (select auth.uid()) or (select is_admin()));
drop policy if exists programs_admin_update on public.programs;
drop policy if exists programs_update_own on public.programs;
create policy programs_update on public.programs
  for update using (owner_id = (select auth.uid()) or (select is_admin()))
             with check (owner_id = (select auth.uid()) or (select is_admin()));
drop policy if exists programs_admin_delete on public.programs;
drop policy if exists programs_delete_own on public.programs;
create policy programs_delete on public.programs
  for delete using (owner_id = (select auth.uid()) or (select is_admin()));

-- race_results: select 2 → 1
drop policy if exists race_results_admin_select on public.race_results;
drop policy if exists race_results_select_own on public.race_results;
create policy race_results_select on public.race_results
  for select using (user_id = (select auth.uid()) or (select is_admin()));

-- sessions: select 3 → 1, update 2 → 1
drop policy if exists sessions_admin_select on public.sessions;
drop policy if exists sessions_select_own on public.sessions;
drop policy if exists sessions_select_shared on public.sessions;
create policy sessions_select on public.sessions
  for select using (
    user_id = (select auth.uid())
    or (shared = true and deleted_at is null)
    or (select is_admin()));
drop policy if exists sessions_admin_update on public.sessions;
drop policy if exists sessions_update_own on public.sessions;
create policy sessions_update on public.sessions
  for update using (user_id = (select auth.uid()) or (select is_admin()))
             with check (user_id = (select auth.uid()) or (select is_admin()));

-- session_segments: select 2 → 1
drop policy if exists segments_select_own on public.session_segments;
drop policy if exists segments_select_shared on public.session_segments;
create policy segments_select on public.session_segments
  for select using (exists (
    select 1 from sessions s
    where s.id = session_segments.session_id
      and (s.user_id = (select auth.uid())
           or (s.shared = true and s.deleted_at is null))));

-- session_metrics: select 2 → 1
drop policy if exists session_metrics_select_own on public.session_metrics;
drop policy if exists session_metrics_select_shared on public.session_metrics;
create policy session_metrics_select on public.session_metrics
  for select using (exists (
    select 1 from sessions s
    where s.id = session_metrics.session_id
      and (s.user_id = (select auth.uid())
           or (s.shared = true and s.deleted_at is null))));

-- segment_metrics: select 2 → 1
drop policy if exists segment_metrics_select_own on public.segment_metrics;
drop policy if exists segment_metrics_select_shared on public.segment_metrics;
create policy segment_metrics_select on public.segment_metrics
  for select using (exists (
    select 1 from session_segments g join sessions s on s.id = g.session_id
    where g.id = segment_metrics.segment_id
      and (s.user_id = (select auth.uid())
           or (s.shared = true and s.deleted_at is null))));

-- ─────────────────────────────────────────── 가드
do $$
declare n int;
begin
  -- 위 14개 테이블에 명령별 permissive 정책이 2개 이상 남으면 실패
  select count(*) into n from (
    select tablename, cmd from pg_policies
    where schemaname = 'public' and permissive = 'PERMISSIVE'
      and cmd <> 'ALL'
      and tablename in ('crew_events','crew_program_enrollments','erg_samples','exercises',
                        'profiles','program_days','programs','race_results','segment_metrics',
                        'session_metrics','session_segments','sessions',
                        'workout_template_items','workout_templates')
    group by tablename, cmd having count(*) > 1) x;
  if n > 0 then
    raise exception '중복 permissive 정책이 % (테이블,명령) 조합에 남아 있다', n;
  end if;

  -- for all 정책이 남아 있으면 실패 (SELECT 분기를 다시 만든다)
  select count(*) into n from pg_policies
  where schemaname = 'public' and cmd = 'ALL'
    and tablename in ('crew_events','crew_program_enrollments','erg_samples','exercises',
                      'profiles','program_days','programs','race_results','segment_metrics',
                      'session_metrics','session_segments','sessions',
                      'workout_template_items','workout_templates');
  if n > 0 then
    raise exception 'for all 정책이 %건 남아 있다', n;
  end if;

  -- 모든 대상 테이블에 SELECT 정책이 정확히 1개 있어야 한다 (읽기 경로 유실 방지)
  select count(*) into n from (
    select t.tablename from unnest(array[
      'crew_events','crew_program_enrollments','erg_samples','exercises','profiles',
      'program_days','programs','race_results','segment_metrics','session_metrics',
      'session_segments','sessions','workout_template_items','workout_templates']) as t(tablename)
    where (select count(*) from pg_policies p
           where p.schemaname='public' and p.tablename = t.tablename and p.cmd='SELECT') <> 1) y;
  if n > 0 then
    raise exception 'SELECT 정책이 1개가 아닌 테이블이 %개', n;
  end if;
end $$;
