-- WOD 수행 기록: 완료 체크에 더해 실제 수행한 무게/횟수/메모를 남길 수 있게 한다.
-- 값 입력은 곧 그 운동을 수행했다는 뜻이므로 완료 행(workout_item_completions)에 함께 저장.
alter table workout_item_completions
  add column if not exists weight_kg numeric,
  add column if not exists reps integer,
  add column if not exists note text;

-- 기존 행의 무게/횟수/메모를 수정하려면 UPDATE 정책이 필요(기존엔 select/insert/delete만 있었음).
-- upsert(merge)로 값 갱신 시 ON CONFLICT DO UPDATE 경로가 이 정책을 사용한다.
drop policy if exists wic_update_own on workout_item_completions;
create policy wic_update_own on workout_item_completions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
