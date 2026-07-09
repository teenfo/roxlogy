-- 목표 계획에 디비전 + 대상 대회 연결 (대회일정에서 "목표 세우기"로 진입 시)
alter table goal_plans add column if not exists division text
  check (division is null or division = any (array[
    'open','pro','doubles','mixed_doubles','pro_doubles','relay','mixed_relay'
  ]));
alter table goal_plans add column if not exists event_name text;
alter table goal_plans add column if not exists event_date date;
