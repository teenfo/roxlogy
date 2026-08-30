-- ============================================================
-- Roxlogy — 시스템 감사 수리 (5) 미인덱스 외래키 26건
--
-- advisor(performance) unindexed_foreign_keys. 현재 데이터 규모에선 체감이
-- 없지만, 부모 행 삭제 시 자식 전체 스캔이 발생하고(크루·프로그램 삭제 등)
-- 조인 경유 RLS 정책이 많아 사용자가 늘수록 비용이 커진다. 스토어 출시 전
-- 정리 대상이라 지금 한 번에 채운다. 인덱스 추가는 되돌릴 수 있는 변경.
-- ============================================================

create index if not exists idx_crew_dues_payments_user on public.crew_dues_payments(user_id);
create index if not exists idx_crew_event_comments_author on public.crew_event_comments(author_id);
create index if not exists idx_crew_event_rsvps_user on public.crew_event_rsvps(user_id);
create index if not exists idx_crew_events_template on public.crew_events(template_id);
create index if not exists idx_crew_events_race_event on public.crew_events(race_event_id);
create index if not exists idx_crew_events_created_by on public.crew_events(created_by);
create index if not exists idx_crew_events_coach on public.crew_events(coach_id);
create index if not exists idx_crew_ledger_created_by on public.crew_ledger(created_by);
create index if not exists idx_crew_post_comments_author on public.crew_post_comments(author_id);
create index if not exists idx_crew_post_likes_user on public.crew_post_likes(user_id);
create index if not exists idx_crew_posts_author on public.crew_posts(author_id);
create index if not exists idx_crew_posts_session on public.crew_posts(session_id);
create index if not exists idx_crew_prog_enroll_created_by on public.crew_program_enrollments(created_by);
create index if not exists idx_crew_prog_enroll_program on public.crew_program_enrollments(program_id);
create index if not exists idx_crews_created_by on public.crews(created_by);
create index if not exists idx_exercise_drills_exercise on public.exercise_drills(exercise_id);
create index if not exists idx_exercise_requests_requested_by on public.exercise_requests(requested_by);
create index if not exists idx_follows_followee on public.follows(followee_id);
create index if not exists idx_notification_prefs_type on public.notification_prefs(type_key);
create index if not exists idx_program_enrollments_program on public.program_enrollments(program_id);
create index if not exists idx_programs_owner on public.programs(owner_id);
create index if not exists idx_race_plans_race_event on public.race_plans(race_event_id);
create index if not exists idx_session_segments_exercise on public.session_segments(exercise_id);
create index if not exists idx_sessions_template on public.sessions(template_id);
create index if not exists idx_wti_exercise on public.workout_template_items(exercise_id);
create index if not exists idx_workout_templates_day on public.workout_templates(program_day_id);
