-- ============================================================
-- Roxlogy — 출전 일정 단일화 (race_plans = source of truth)
--
-- 출전 일정 등록 경로가 두 갈래였다:
--   1) 크루 일정 "내 대회 일정 등록" → race_plans
--   2) 계산기 목표 저장(event_name/event_date) → goal_plans
-- 목표에 대회·날짜를 넣으면 출전 선언과 같으므로, goal_plans 저장 시
-- 트리거로 race_plans 에 자동 반영한다 (같은 날짜 기존 일정이 있으면
-- 연결·보강만 하고 새로 만들지 않음 → 중복 방지).
-- 사용자가 직접 고친 race_plans 값(제목·bib·메모)은 덮어쓰지 않는다.
-- ============================================================

alter table public.race_plans
  add column if not exists goal_plan_id uuid
    references public.goal_plans(id) on delete set null;

create index if not exists race_plans_goal_idx
  on public.race_plans(goal_plan_id) where goal_plan_id is not null;

create or replace function public.sync_goal_to_race_plan() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_division text;
  v_id uuid;
begin
  -- 대회·날짜가 없거나 지난 날짜면 출전 일정으로 만들지 않는다
  if new.event_date is null or new.event_date < current_date then
    return new;
  end if;

  v_division := case new.division
    when 'open' then '오픈'
    when 'pro' then '프로'
    when 'doubles' then '더블'
    when 'mixed_doubles' then '믹스 더블'
    when 'pro_doubles' then '프로 더블'
    when 'relay' then '릴레이'
    when 'mixed_relay' then '믹스 릴레이'
    else new.division
  end;

  -- 1) 이 목표가 이미 만든 출전 일정이 있으면 날짜·디비전만 따라간다
  select id into v_id from race_plans where goal_plan_id = new.id limit 1;
  if v_id is not null then
    update race_plans
    set race_date = new.event_date,
        division = coalesce(nullif(division, ''), v_division)
    where id = v_id;
    return new;
  end if;

  -- 2) 같은 날짜에 직접 등록한 일정이 있으면 연결·보강만 (중복 생성 금지)
  update race_plans
  set goal_plan_id = new.id,
      division = coalesce(nullif(division, ''), v_division)
  where user_id = new.user_id and race_date = new.event_date
    and goal_plan_id is null
  returning id into v_id;
  if v_id is not null then
    return new;
  end if;

  -- 3) 없으면 새 출전 일정 생성
  insert into race_plans (user_id, title, race_date, division, goal_plan_id)
  values (
    new.user_id,
    coalesce(nullif(new.event_name, ''), 'HYROX'),
    new.event_date,
    v_division,
    new.id
  );
  return new;
end;
$$;

drop trigger if exists goal_plans_sync_race on public.goal_plans;
create trigger goal_plans_sync_race
  after insert or update of event_name, event_date, division
  on public.goal_plans
  for each row execute function public.sync_goal_to_race_plan();

-- 기존 데이터 백필: 대회·미래 날짜가 있는 목표를 출전 일정으로 반영
do $$
declare g record;
begin
  for g in
    select * from goal_plans
    where event_date is not null and event_date >= current_date
    order by created_at
  loop
    if not exists (
      select 1 from race_plans
      where user_id = g.user_id and race_date = g.event_date
    ) then
      insert into race_plans (user_id, title, race_date, division, goal_plan_id)
      values (
        g.user_id,
        coalesce(nullif(g.event_name, ''), 'HYROX'),
        g.event_date,
        case g.division
          when 'open' then '오픈'
          when 'pro' then '프로'
          when 'doubles' then '더블'
          when 'mixed_doubles' then '믹스 더블'
          when 'pro_doubles' then '프로 더블'
          when 'relay' then '릴레이'
          when 'mixed_relay' then '믹스 릴레이'
          else g.division
        end,
        g.id
      );
    else
      update race_plans set goal_plan_id = g.id
      where user_id = g.user_id and race_date = g.event_date
        and goal_plan_id is null;
    end if;
  end loop;
end;
$$;
