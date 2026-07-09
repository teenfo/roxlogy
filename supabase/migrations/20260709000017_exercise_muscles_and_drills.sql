-- 운동 DB: 타겟 부위(muscles) + 사용자가 직접 추가하는 도움 훈련(drills)

-- 타겟 부위: 표준 키 배열 (웹에서 i18n muscle.<key>로 표시). 스테이션·러닝 먼저 채움.
alter table exercises add column if not exists muscles text[];

update exercises set muscles = array['lats','triceps','shoulders','core'] where station_type = 'station_1';
update exercises set muscles = array['quads','glutes','calves','core'] where station_type = 'station_2';
update exercises set muscles = array['back','biceps','hamstrings','core'] where station_type = 'station_3';
update exercises set muscles = array['full_body','quads','chest','core'] where station_type = 'station_4';
update exercises set muscles = array['back','quads','biceps','core'] where station_type = 'station_5';
update exercises set muscles = array['grip','forearms','traps','core'] where station_type = 'station_6';
update exercises set muscles = array['quads','glutes','hamstrings','core'] where station_type = 'station_7';
update exercises set muscles = array['quads','glutes','shoulders','core'] where station_type = 'station_8';
update exercises set muscles = array['quads','hamstrings','calves','glutes'] where category = 'running';

-- 사용자가 특정 운동에 직접 입력·추가하는 "도움이 되는 훈련" 메모 (본인만 조회)
create table if not exists exercise_drills (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references exercises(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  body text,
  created_at timestamptz not null default now()
);

create index if not exists idx_exercise_drills_owner on exercise_drills(user_id, exercise_id);

alter table exercise_drills enable row level security;

create policy exercise_drills_select_own on exercise_drills
  for select using (user_id = auth.uid());
create policy exercise_drills_insert_own on exercise_drills
  for insert with check (user_id = auth.uid());
create policy exercise_drills_update_own on exercise_drills
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy exercise_drills_delete_own on exercise_drills
  for delete using (user_id = auth.uid());
