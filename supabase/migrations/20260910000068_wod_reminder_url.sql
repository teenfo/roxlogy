-- 오늘의 WOD 알림이 /dashboard 로 가던 것을 오늘 워크아웃으로 바로 보낸다.
--
-- 알림 제목이 "오늘의 WOD" 인데 목적지가 대시보드라 한 번 더 찾아 들어가야 했다.
-- 활성 프로그램에서 그날 일차를 계산해 /workouts/<template> 로 링크하고,
-- 프로그램이 없거나 쉬는 날이면 /schedule 로 보낸다 (대시보드보다 맥락에 맞다).

-- 일차 계산 규칙은 web 의 programDayNumber() 와 같아야 한다:
--   시작 전이면 없음, repeat 면 (경과일 % 사이클) + 1, 아니면 경과일 + 1,
--   종료일을 지났거나 일차가 사이클을 넘으면 없음.
create or replace function public.rox_today_wod_url(p_user uuid, p_date date)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with e as (
    select pe.program_id, pe.start_date, pe.repeat, pe.end_date
      from program_enrollments pe
     where pe.user_id = p_user and pe.active
     limit 1
  ), c as (
    select e.*,
           (p_date - e.start_date) as days_since,
           (select max(pd.day_index) from program_days pd
             where pd.program_id = e.program_id) as cycle_len
      from e
  ), d as (
    select c.program_id, c.cycle_len,
           case
             when c.days_since < 0 then null
             when c.end_date is not null and p_date > c.end_date then null
             when c.repeat then
               case when coalesce(c.cycle_len, 0) <= 0 then null
                    else (c.days_since % c.cycle_len) + 1 end
             else c.days_since + 1
           end as day_no
      from c
  )
  select '/workouts/' || w.id::text
    from d
    join program_days pd
      on pd.program_id = d.program_id and pd.day_index = d.day_no
    join workout_templates w on w.program_day_id = pd.id
   where d.day_no is not null and d.day_no <= d.cycle_len
   order by w.created_at
   limit 1;
$$;

-- 호출자 검증이 없는 내부 헬퍼다 — 절대 anon·authenticated 에 grant 하지 않는다.
revoke all on function public.rox_today_wod_url(uuid, date) from public;

create or replace function public.enqueue_wod_reminders()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  r record;
  v_loc text;
begin
  for r in
    select p.id, p.timezone, p.wod_reminder_time, coalesce(p.locale, 'ko') as loc,
           (now() at time zone coalesce(p.timezone, 'UTC')) as local_now
    from public.profiles p
    where p.wod_reminder_time is not null
  loop
    if mod(cast(extract(epoch from (r.local_now::time - r.wod_reminder_time)) as integer) + 86400, 86400) < 300 then
      if not exists (
        select 1 from public.notifications n
        where n.user_id = r.id and n.type_key = 'wod_reminder'
          and (n.created_at at time zone coalesce(r.timezone, 'UTC'))::date = r.local_now::date
      ) then
        v_loc := r.loc;
        perform public.enqueue_notification(
          r.id, 'wod_reminder',
          case v_loc when 'en' then 'Today''s WOD'
                     when 'es' then 'El WOD de hoy' else '오늘의 WOD' end,
          case v_loc when 'en' then 'Check today''s workout and log it.'
                     when 'es' then 'Consulta el entrenamiento de hoy y regístralo.'
                     else '오늘의 워크아웃을 확인하고 기록해 보세요.' end,
          coalesce(
            public.rox_today_wod_url(r.id, r.local_now::date),
            '/schedule'));
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.enqueue_wod_reminders() from public;

-- 이미 쌓인 알림 — 그날 워크아웃을 되짚을 수는 없으니 일정 화면으로 보낸다.
update public.notifications
   set url = '/schedule'
 where type_key = 'wod_reminder' and url = '/dashboard';

-- 검증 — 임시 프로그램으로 일차 계산을 확인하고 되돌린다.
do $$
declare
  v_user uuid;
  v_prog uuid;
  v_url text;
  v_want text;
begin
  select id into v_user from public.profiles order by created_at limit 1;
  if v_user is null then
    raise notice 'no profiles — skipping guard';
    return;
  end if;

  -- 활성 등록은 사용자당 하나뿐(부분 유니크 인덱스)이라 잠시 내린다. 롤백된다.
  update public.program_enrollments set active = false
   where user_id = v_user and active;

  insert into public.programs (owner_id, title)
       values (v_user, '__guard__') returning id into v_prog;
  insert into public.program_days (program_id, day_index)
       values (v_prog, 1), (v_prog, 2), (v_prog, 3);
  insert into public.workout_templates (program_day_id, title, type, structure)
       select pd.id, 'guard ' || pd.day_index, 'strength', '[]'::jsonb
         from public.program_days pd where pd.program_id = v_prog;

  insert into public.program_enrollments (user_id, program_id, start_date, active, repeat)
       values (v_user, v_prog, current_date - 4, true, true);

  -- repeat · 사이클 3 · 경과 4일 → 2일차
  select '/workouts/' || w.id::text into v_want
    from public.program_days pd
    join public.workout_templates w on w.program_day_id = pd.id
   where pd.program_id = v_prog and pd.day_index = 2;
  v_url := public.rox_today_wod_url(v_user, current_date);
  if v_url is distinct from v_want then
    raise exception 'wod url mismatch: got % want %', v_url, v_want;
  end if;

  -- 시작 전에는 워크아웃이 없다
  if public.rox_today_wod_url(v_user, current_date - 10) is not null then
    raise exception 'expected null before start_date';
  end if;

  -- 종료일을 지나면 없다
  update public.program_enrollments set end_date = current_date - 1
   where user_id = v_user and program_id = v_prog;
  if public.rox_today_wod_url(v_user, current_date) is not null then
    raise exception 'expected null after end_date';
  end if;

  raise exception '__guard_rollback__';
exception when others then
  if sqlerrm <> '__guard_rollback__' then raise; end if;
end $$;
