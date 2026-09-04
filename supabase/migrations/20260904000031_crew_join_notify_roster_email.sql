-- 크루 운영 편의 3종
--  1) 가입 신청(pending) 발생 시 운영진(리더·부리더)에게 알림 — 관리 탭에 들어가야만
--     신청자를 알 수 있던 문제 해결.
--  2) 운영 명단(crew_manage_roster)에 계정 주소(email) 추가 — 동명이인 식별용.
--     함수는 이미 스태프·관리자만 행을 돌려주므로 이메일도 같은 게이트 안에 머문다.
--  (사진첩 링크는 crews.links JSONB 키라 스키마 변경이 없다.)

-- 1) 알림 종류 ---------------------------------------------------------------
insert into public.notification_types(key, description, default_enabled)
values ('crew_join_request', '크루 가입 신청 (운영진)', true)
on conflict (key) do nothing;

create or replace function public.notify_crew_join_request()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_crew text;
  v_slug text;
  r record;
  v_title text;
  v_body text;
begin
  if new.status is distinct from 'pending' then return new; end if;

  select nullif(p.display_name, '') into v_name from public.profiles p where p.id = new.user_id;
  select c.name, c.slug into v_crew, v_slug from public.crews c where c.id = new.crew_id;
  if v_slug is null then return new; end if;

  for r in
    select m.user_id, coalesce(pr.locale, 'ko') as loc
    from public.crew_members m
    join public.profiles pr on pr.id = m.user_id
    where m.crew_id = new.crew_id
      and m.status = 'active'
      and m.role in ('owner', 'coach')
      and m.user_id <> new.user_id
  loop
    v_title := case r.loc when 'en' then 'New join request'
                          when 'es' then 'Nueva solicitud de ingreso'
                          else '새 가입 신청' end;
    v_body := case r.loc
      when 'en' then coalesce(v_name, 'Someone') || ' asked to join ' || coalesce(v_crew, 'your crew') || '.'
      when 'es' then coalesce(v_name, 'Alguien') || ' solicitó unirse a ' || coalesce(v_crew, 'tu crew') || '.'
      else coalesce(v_name, '누군가') || '님이 ' || coalesce(v_crew, '크루') || ' 가입을 신청했습니다.' end;
    perform public.enqueue_notification(
      r.user_id, 'crew_join_request', v_title, v_body,
      '/crews/' || v_slug || '/manage');
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_crew_join_request() from public;

drop trigger if exists crew_members_notify_join on public.crew_members;
create trigger crew_members_notify_join
  after insert on public.crew_members
  for each row execute function public.notify_crew_join_request();

-- 2) 운영 명단에 계정 주소 ---------------------------------------------------
-- returns table 컬럼이 늘어나므로 create or replace 로는 안 되고 drop 후 재정의한다.
drop function if exists public.crew_manage_roster(text);
create or replace function public.crew_manage_roster(p_slug text)
returns table(user_id uuid, display_name text, email text, role text, status text, joined_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select m.user_id, coalesce(p.display_name, 'Athlete'), u.email::text, m.role, m.status, m.joined_at
  from crew_members m
  join crews c on c.id = m.crew_id
  join profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where c.slug = p_slug and ((select is_crew_staff(c.id)) or (select is_admin()))
  order by case m.status when 'pending' then 0 else 1 end,
           case m.role when 'owner' then 0 when 'coach' then 1 else 2 end,
           m.joined_at;
$$;
grant execute on function public.crew_manage_roster(text) to authenticated;

-- 가드 ------------------------------------------------------------------------
do $$
declare n int;
begin
  if not exists (select 1 from public.notification_types where key = 'crew_join_request') then
    raise exception '가드: crew_join_request 알림 종류가 없습니다';
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'crew_members_notify_join'
      and tgrelid = 'public.crew_members'::regclass and not tgisinternal
  ) then
    raise exception '가드: crew_members_notify_join 트리거가 없습니다';
  end if;

  -- 운영 명단이 email 을 돌려주는지 (컬럼 이름·순서 확인)
  select count(*) into n
  from pg_proc p, unnest(p.proargnames) as a(nm)
  where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_manage_roster'
    and a.nm = 'email';
  if n <> 1 then raise exception '가드: crew_manage_roster 에 email 출력 컬럼이 없습니다'; end if;

  -- 이메일 노출 함수는 반드시 security definer + 스태프 게이트를 유지해야 한다
  if not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = 'crew_manage_roster'
      and p.prosecdef and pg_get_functiondef(p.oid) like '%is_crew_staff%'
  ) then
    raise exception '가드: crew_manage_roster 의 스태프 게이트가 사라졌습니다';
  end if;

  -- 트리거 전용 함수는 클라이언트가 직접 호출할 수 없어야 한다
  if has_function_privilege('anon', 'public.notify_crew_join_request()', 'execute')
     or has_function_privilege('authenticated', 'public.notify_crew_join_request()', 'execute') then
    raise exception '가드: notify_crew_join_request 가 클라이언트에 노출됐습니다';
  end if;
end $$;
