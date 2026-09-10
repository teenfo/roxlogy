-- 오늘 훈련이 없는 날에는 "오늘의 WOD" 알림을 보내지 않는다.
--
-- 지금까지 크론은 profiles.wod_reminder_time 만 보고 매일 발송했다. 프로그램이
-- 없거나 아직 시작 전이어도 "오늘의 워크아웃을 확인하고 기록해 보세요" 가 왔다
-- (실제 사례: 시작일이 나흘 뒤인데 이틀 연속 알림).
--
-- 판정을 셋으로 나눈다.
--   · 오늘 프로그램 일차 자체가 없다(프로그램 없음·시작 전·종료 후·사이클 초과)
--     → 보내지 않는다.
--   · 일차가 있고 워크아웃이 있다 → 지금까지와 같은 문구 + 그 워크아웃으로 링크.
--   · 일차는 있는데 워크아웃이 없다(휴식·능동 회복) → 쉬는 날 문구 + 그 날의
--     focus 를 본문으로, 링크는 일정 화면. 훈련이 없다고 침묵하면 "오늘 쉬는
--     날인가 앱이 고장인가"를 알 수 없다.

-- 068 의 URL 전용 헬퍼를 확장판으로 교체한다. 반환 타입이 바뀌므로 drop 후 생성.
drop function if exists public.rox_today_wod_url(uuid, date);

create or replace function public.rox_today_wod(p_user uuid, p_date date)
returns jsonb
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
    -- 일차 계산 규칙은 web 의 programDayNumber() 와 같아야 한다
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
  select jsonb_build_object(
           'day_no', d.day_no,
           'focus', pd.focus,
           'has_workout', exists (
             select 1 from workout_templates w where w.program_day_id = pd.id),
           'url', coalesce(
             (select '/workouts/' || w.id::text
                from workout_templates w
               where w.program_day_id = pd.id
               order by w.created_at limit 1),
             '/schedule'))
    from d
    join program_days pd
      on pd.program_id = d.program_id and pd.day_index = d.day_no
   where d.day_no is not null and d.day_no <= d.cycle_len
   limit 1;
$$;

-- 호출자 검증이 없는 내부 헬퍼다 — 절대 anon·authenticated 에 grant 하지 않는다.
revoke all on function public.rox_today_wod(uuid, date) from public;

create or replace function public.enqueue_wod_reminders()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  r record;
  v_loc text;
  v_wod jsonb;
  v_has boolean;
  v_focus text;
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
        v_wod := public.rox_today_wod(r.id, r.local_now::date);
        -- 오늘 프로그램 일정 자체가 없으면 알릴 것도 없다
        if v_wod is null then continue; end if;

        v_loc := r.loc;
        v_has := coalesce((v_wod->>'has_workout')::boolean, false);
        v_focus := nullif(trim(coalesce(v_wod->>'focus', '')), '');

        if v_has then
          perform public.enqueue_notification(
            r.id, 'wod_reminder',
            case v_loc when 'en' then 'Today''s WOD'
                       when 'es' then 'El WOD de hoy' else '오늘의 WOD' end,
            case v_loc when 'en' then 'Check today''s workout and log it.'
                       when 'es' then 'Consulta el entrenamiento de hoy y regístralo.'
                       else '오늘의 워크아웃을 확인하고 기록해 보세요.' end,
            v_wod->>'url');
        else
          perform public.enqueue_notification(
            r.id, 'wod_reminder',
            case v_loc when 'en' then 'Rest day'
                       when 'es' then 'Día de descanso' else '오늘은 쉬는 날' end,
            coalesce(v_focus,
              case v_loc when 'en' then 'No session scheduled today.'
                         when 'es' then 'Hoy no hay entrenamiento programado.'
                         else '오늘은 예정된 훈련이 없습니다.' end),
            v_wod->>'url');
        end if;
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.enqueue_wod_reminders() from public;

-- 검증 — 시작 전 / 워크아웃 있는 날 / 휴식일 세 경우. 전부 롤백된다.
do $$
declare
  v_user uuid;
  v_prog uuid;
  v_day1 uuid;
  v_url text;
begin
  select id into v_user from public.profiles order by created_at limit 1;
  if v_user is null then
    raise notice 'no profiles — skipping guard';
    return;
  end if;

  -- 크론이 이 사용자에게 발송하도록 시각·시간대를 맞추고, 오늘치 알림을 비운다
  update public.profiles
     set timezone = 'UTC', wod_reminder_time = (now() at time zone 'UTC')::time
   where id = v_user;
  delete from public.notifications
   where user_id = v_user and type_key = 'wod_reminder';
  insert into public.notification_prefs (user_id, type_key, enabled)
       values (v_user, 'wod_reminder', true)
  on conflict (user_id, type_key) do update set enabled = true;

  update public.program_enrollments set active = false
   where user_id = v_user and active;

  insert into public.programs (owner_id, title)
       values (v_user, '__guard__') returning id into v_prog;
  insert into public.program_days (program_id, day_index)
       values (v_prog, 1), (v_prog, 2);
  select id into v_day1 from public.program_days
   where program_id = v_prog and day_index = 1;
  insert into public.workout_templates (program_day_id, title, type, structure)
       values (v_day1, 'guard', 'strength', '[]'::jsonb);

  -- 1) 시작 전 → 발송하지 않는다
  insert into public.program_enrollments (user_id, program_id, start_date, active, repeat)
       values (v_user, v_prog, current_date + 3, true, false);
  perform public.enqueue_wod_reminders();
  if exists (select 1 from public.notifications
              where user_id = v_user and type_key = 'wod_reminder') then
    raise exception 'reminder sent although the program has not started';
  end if;

  -- 2) 오늘이 1일차(워크아웃 있음) → 그 워크아웃으로 링크
  update public.program_enrollments set start_date = current_date
   where user_id = v_user and program_id = v_prog;
  perform public.enqueue_wod_reminders();
  select url into v_url from public.notifications
   where user_id = v_user and type_key = 'wod_reminder'
   order by created_at desc limit 1;
  if v_url is null or v_url not like '/workouts/%' then
    raise exception 'expected a workout link, got %', coalesce(v_url, '(none)');
  end if;

  -- 3) 휴식일(워크아웃 없음) → 발송하되 일정 화면으로
  delete from public.notifications
   where user_id = v_user and type_key = 'wod_reminder';
  delete from public.workout_templates where program_day_id = v_day1;
  perform public.enqueue_wod_reminders();
  select url into v_url from public.notifications
   where user_id = v_user and type_key = 'wod_reminder'
   order by created_at desc limit 1;
  if v_url is distinct from '/schedule' then
    raise exception 'expected /schedule on a rest day, got %', coalesce(v_url, '(none)');
  end if;

  raise exception '__guard_rollback__';
exception when others then
  if sqlerrm <> '__guard_rollback__' then raise; end if;
end $$;
