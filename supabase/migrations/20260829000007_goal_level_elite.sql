-- 목표 레벨에 엘리트 추가 (입문/중급/상급/엘리트)
alter table public.goal_plans
  drop constraint if exists goal_plans_level_check;
alter table public.goal_plans
  add constraint goal_plans_level_check
    check (level in ('beginner', 'intermediate', 'advanced', 'elite'));
