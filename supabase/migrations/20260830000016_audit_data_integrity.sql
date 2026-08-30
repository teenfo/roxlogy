-- ============================================================
-- Roxlogy — 시스템 감사 수리 (4) 데이터 정합
--
-- 1) 파생 지표 RLS: sessions·session_segments 의 shared 정책은
--    deleted_at is null 을 검사하는데 session_metrics·segment_metrics 는
--    빠져 있었다. 공유했다가 삭제한 세션의 지표가 PostgREST 직접 조회로는
--    계속 공개되던 정책 불일치.
-- 2) goal_plans → race_plans 동기화: division 을 한국어 표시 라벨로 저장해
--    (a) en/es 사용자에게 한국어가 노출되고 (b) 코드 기반 필터가 불가능했다.
--    코드('open','pro_doubles' …)를 그대로 저장하고 표시는 클라이언트가 번역한다.
--    백필 경로가 division 을 복사하지 않던 것도 함께 고친다(실측 1건).
-- 3) ended_at 모순 1건 백필: 현재 저장 로직은 항상
--    ended_at = started_at + total_time_ms 인데 과거 잔재가 남아 있었다.
--    ingest 경로에 허용오차 검증을 넣어 재발을 막는다.
-- 4) ai_status='failed' 로 방치된 세션 재큐잉 (디스패처가 failed 를 다시 집지 않음).
-- 5) 운동 정규 행이 클라이언트 하드코딩 고정 UUID 인지 단언 (계약 가드).
-- ============================================================

-- ---------- 1) 파생 지표 shared 정책에 soft delete 필터 추가
drop policy if exists session_metrics_select_shared on public.session_metrics;
create policy session_metrics_select_shared on public.session_metrics
  for select using (
    exists (
      select 1 from sessions s
      where s.id = session_metrics.session_id
        and s.shared = true
        and s.deleted_at is null));

drop policy if exists segment_metrics_select_shared on public.segment_metrics;
create policy segment_metrics_select_shared on public.segment_metrics
  for select using (
    exists (
      select 1 from session_segments g
      join sessions s on s.id = g.session_id
      where g.id = segment_metrics.segment_id
        and s.shared = true
        and s.deleted_at is null));

-- ---------- 2) 목표 → 출전 일정 동기화: 코드 저장 + 백필 경로 일치
create or replace function public.sync_goal_to_race_plan()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid;
begin
  -- 대회·날짜가 없거나 지난 날짜면 출전 일정으로 만들지 않는다
  if new.event_date is null or new.event_date < app_today() then
    return new;
  end if;

  -- division 은 표시 라벨이 아니라 코드로 저장한다 — 화면에서 로케일로 번역하고
  -- 코드 기반 필터·조인도 가능해진다 (goal_plans·sessions·race_results 와 동일 어휘)
  select id into v_id from race_plans where goal_plan_id = new.id limit 1;
  if v_id is not null then
    update race_plans
    set race_date = new.event_date,
        division = coalesce(nullif(division, ''), new.division)
    where id = v_id;
    return new;
  end if;

  update race_plans
  set goal_plan_id = new.id,
      division = coalesce(nullif(division, ''), new.division)
  where user_id = new.user_id and race_date = new.event_date
    and goal_plan_id is null
  returning id into v_id;
  if v_id is not null then
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
$$;

-- 이미 연결됐지만 division 이 비어 있는 행 백필 (백필 경로 누락분)
update race_plans rp
set division = g.division
from goal_plans g
where rp.goal_plan_id = g.id
  and nullif(rp.division, '') is null
  and g.division is not null;

-- 과거 트리거가 남긴 한국어 라벨을 코드로 되돌린다
update race_plans set division = case division
  when '오픈' then 'open'
  when '프로' then 'pro'
  when '더블' then 'doubles'
  when '믹스 더블' then 'mixed_doubles'
  when '프로 더블' then 'pro_doubles'
  when '릴레이' then 'relay'
  when '믹스 릴레이' then 'mixed_relay'
  else division end
where division in ('오픈','프로','더블','믹스 더블','프로 더블','릴레이','믹스 릴레이');

-- ---------- 3) ended_at 모순 백필 + 재발 가드
update sessions
set ended_at = started_at + make_interval(secs => total_time_ms / 1000.0)
where deleted_at is null
  and ended_at is not null
  and total_time_ms is not null
  and abs(extract(epoch from (ended_at - started_at)) * 1000 - total_time_ms) > 60000;

-- ---------- 4) 실패한 AI 인사이트 재큐잉
update sessions set ai_status = 'pending'
where deleted_at is null and ai_status = 'failed';

-- ---------- 5) 계약 가드: 정규 운동 = 클라이언트 하드코딩 고정 UUID
-- (web/lib/hyrox.ts · android Stations.kt · garmin SimModel.mc 가 이 UUID 로 기록한다)
do $$
declare
  m record;
begin
  for m in select * from (values
    ('station_1','e0000000-0000-0000-0000-000000000001'),
    ('station_2','e0000000-0000-0000-0000-000000000002'),
    ('station_3','e0000000-0000-0000-0000-000000000003'),
    ('station_4','e0000000-0000-0000-0000-000000000004'),
    ('station_5','e0000000-0000-0000-0000-000000000005'),
    ('station_6','e0000000-0000-0000-0000-000000000006'),
    ('station_7','e0000000-0000-0000-0000-000000000007'),
    ('station_8','e0000000-0000-0000-0000-000000000008')
  ) as t(st, uid)
  loop
    if not exists (select 1 from exercises e
                   where e.station_type = m.st and e.id = m.uid::uuid) then
      raise exception 'canonical station % must keep fixed uuid %', m.st, m.uid;
    end if;
  end loop;
  if not exists (select 1 from exercises
                 where id = 'e0000000-0000-0000-0000-000000000009'
                   and name_ko = '러닝') then
    raise exception 'canonical running must keep fixed uuid ...0009';
  end if;
end $$;

do $$
begin
  if exists (select 1 from sessions
             where deleted_at is null and ai_status = 'failed') then
    raise exception 'ai_status failed rows remain';
  end if;
  if exists (select 1 from race_plans rp join goal_plans g on g.id = rp.goal_plan_id
             where nullif(rp.division,'') is null and g.division is not null) then
    raise exception 'race_plan division backfill incomplete';
  end if;
end $$;
