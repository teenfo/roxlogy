-- Roxlogy — 목표 저장 시 "내 대회 일정에 추가"를 선택제로
--
-- sync_goal_to_race_plan 은 목표에 미래 event_date 가 있으면 무조건 race_plans 행을
-- 만들어 왔다. 사용자가 목표만 잡고 일정에는 안 넣고 싶어도 방법이 없었다.
-- goal_plans.add_to_schedule 로 의사를 받아 트리거가 그것을 따르게 한다.
--
-- 기본값 true — MCP·기존 클라이언트 등 이 컬럼을 모르는 경로는 지금까지와 동일하게
-- 동작한다(동작 변경은 웹이 명시적으로 false 를 보낼 때만).
--
-- 주의: 이미 연결된 일정의 날짜·디비전 동기화(1단계)와 같은 날짜의 기존 일정 흡수
-- (2단계)는 플래그와 무관하게 유지한다 — 사용자가 직접 만든 일정을 목표와 맞춰
-- 두는 것은 "새로 만드는" 행위가 아니다.

alter table public.goal_plans
  add column if not exists add_to_schedule boolean not null default true;

comment on column public.goal_plans.add_to_schedule is
  '목표 저장 시 race_plans 에 대회 일정을 새로 만들지 여부. '
  '이미 연결됐거나 같은 날짜의 기존 일정을 흡수하는 동작은 이 값과 무관하다.';

create or replace function public.sync_goal_to_race_plan()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if new.event_date is null or new.event_date < app_today() then
    return new;
  end if;

  -- 1) 이미 이 목표에 연결된 일정 → 날짜·디비전만 맞춘다 (플래그 무관)
  select id into v_id from race_plans where goal_plan_id = new.id limit 1;
  if v_id is not null then
    update race_plans
    set race_date = new.event_date,
        division = coalesce(nullif(division, ''), new.division)
    where id = v_id;
    return new;
  end if;

  -- 2) 같은 날짜의 미연결 일정이 있으면 그것을 이 목표에 연결 (플래그 무관 —
  --    사용자가 직접 만든 일정이므로 새로 만드는 게 아니다)
  update race_plans
  set goal_plan_id = new.id,
      division = coalesce(nullif(division, ''), new.division)
  where user_id = new.user_id and race_date = new.event_date
    and goal_plan_id is null
  returning id into v_id;
  if v_id is not null then
    return new;
  end if;

  -- 3) 새로 만드는 것은 사용자가 원할 때만
  if not coalesce(new.add_to_schedule, true) then
    return new;
  end if;

  insert into race_plans (user_id, title, race_date, division, goal_plan_id)
  values (
    new.user_id,
    coalesce(nullif(new.event_name, ''), 'HYROX'),
    new.event_date,
    new.division,
    new.id
  );
  return new;
end;
$function$;

-- 가드: 플래그가 false 인 목표는 일정을 새로 만들지 않아야 한다
do $$
declare
  uid uuid; gid uuid; n int; d date := app_today() + 40;
begin
  select id into uid from profiles limit 1;
  if uid is null then return; end if;

  insert into goal_plans (user_id, event_name, event_date, division,
                          target_total_ms, level, add_to_schedule)
  values (uid, 'GUARD 테스트', d, 'open', 5400000, 'intermediate', false)
  returning id into gid;
  select count(*) into n from race_plans where goal_plan_id = gid;
  if n <> 0 then
    raise exception 'add_to_schedule=false 인데 일정이 % 건 생성됐다', n;
  end if;

  insert into goal_plans (user_id, event_name, event_date, division,
                          target_total_ms, level, add_to_schedule)
  values (uid, 'GUARD 테스트2', d + 1, 'open', 5400000, 'intermediate', true)
  returning id into gid;
  select count(*) into n from race_plans where goal_plan_id = gid;
  if n <> 1 then
    raise exception 'add_to_schedule=true 인데 일정이 % 건 생성됐다(1이어야 함)', n;
  end if;

  -- 테스트 흔적 제거
  delete from race_plans where title like 'GUARD 테스트%';
  delete from goal_plans where event_name like 'GUARD 테스트%';
end $$;
