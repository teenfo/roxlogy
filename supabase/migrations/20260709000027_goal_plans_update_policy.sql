-- 목표 수정 기능: goal_plans에 소유자 UPDATE 정책이 없어 update가 RLS로 막혀
-- 저장이 되지 않았다. 소유자 본인 목표를 수정할 수 있도록 정책 추가.
create policy goal_plans_update_own on goal_plans
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
