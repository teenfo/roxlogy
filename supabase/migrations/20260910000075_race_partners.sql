-- 더블·릴레이 파트너 — 등록한 사람이 초대하고, 상대가 수락한다.
--
-- 계획을 복제하지 않는다. 한 대회 계획에 참가자가 여럿 붙는 구조라 소유자가
-- 날짜·디비전을 고치면 파트너 쪽도 그대로 따라간다. 복제하면 둘이 갈라진다.

create table if not exists public.race_plan_partners (
  plan_id uuid not null references public.race_plans(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  invited_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (plan_id, user_id)
);

create index if not exists race_plan_partners_user_idx
  on public.race_plan_partners (user_id, status);

alter table public.race_plan_partners enable row level security;

-- 명령별로 정책 하나씩. 소유자와 당사자만 본다.
drop policy if exists rpp_select on public.race_plan_partners;
create policy rpp_select on public.race_plan_partners for select
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.race_plans rp
                where rp.id = plan_id and rp.user_id = (select auth.uid()))
  );

-- 초대는 계획 소유자만. 자기 자신은 초대할 수 없다.
drop policy if exists rpp_insert on public.race_plan_partners;
create policy rpp_insert on public.race_plan_partners for insert
  with check (
    invited_by = (select auth.uid())
    and user_id <> (select auth.uid())
    and exists (select 1 from public.race_plans rp
                 where rp.id = plan_id and rp.user_id = (select auth.uid()))
  );

-- 응답은 당사자만 (수락·거절). 상태 전이는 RPC 가 좁힌다.
drop policy if exists rpp_update on public.race_plan_partners;
create policy rpp_update on public.race_plan_partners for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 초대 취소는 소유자만.
drop policy if exists rpp_delete on public.race_plan_partners;
create policy rpp_delete on public.race_plan_partners for delete
  using (
    exists (select 1 from public.race_plans rp
             where rp.id = plan_id and rp.user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------- 검색
-- 파트너 후보 — **내 크루원 · 내가 팔로우하는 사람**은 이름으로, 그 밖의
-- 사람은 **이메일 정확 일치**로만 찾는다. 이름으로 전체 사용자를 훑을 수 있게
-- 하면 그 순간부터 가입자 목록이 공개된 셈이라 되돌릴 수 없다.
create or replace function public.find_partner_candidates(p_q text)
returns table(user_id uuid, display_name text, division text, source text)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select (select auth.uid()) as id),
  q as (select btrim(coalesce(p_q, '')) as s),
  by_email as (
    select p.id, coalesce(p.display_name, 'Athlete') as nm, p.division,
           'email'::text as src
      from profiles p
      join auth.users u on u.id = p.id
     where (select s from q) like '%@%'
       and lower(u.email) = lower((select s from q))
       and p.id <> (select id from me)
  ),
  by_name as (
    select distinct p.id, coalesce(p.display_name, 'Athlete') as nm, p.division,
           case when exists (
                  select 1 from crew_members a
                    join crew_members b
                      on b.crew_id = a.crew_id and b.status = 'active'
                   where a.user_id = p.id and a.status = 'active'
                     and b.user_id = (select id from me))
                then 'crew' else 'follow' end as src
      from profiles p
     where length((select s from q)) >= 1
       and (select s from q) not like '%@%'
       and p.display_name ilike '%' || replace(replace((select s from q), '%', '\%'), '_', '\_') || '%'
       and p.id <> (select id from me)
       and (
         exists (select 1 from crew_members a
                   join crew_members b
                     on b.crew_id = a.crew_id and b.status = 'active'
                  where a.user_id = p.id and a.status = 'active'
                    and b.user_id = (select id from me))
         or exists (select 1 from follows f
                     where f.follower_id = (select id from me)
                       and f.followee_id = p.id)
       )
  )
  select * from (
    select id, nm, division, src from by_email
    union all
    select id, nm, division, src from by_name
  ) r
  where (select id from me) is not null
  order by r.src, r.nm
  limit 20;
$$;

grant execute on function public.find_partner_candidates(text) to anon, authenticated;

-- ---------------------------------------------------------- 초대 / 응답
create or replace function public.invite_race_partner(p_plan uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
  v_date date;
  v_name text;
  v_loc text;
begin
  select rp.user_id, rp.title, rp.race_date into v_owner, v_title, v_date
    from race_plans rp where rp.id = p_plan;
  if v_owner is null or v_owner <> (select auth.uid()) then
    raise exception 'not_your_plan';
  end if;
  if p_user = v_owner then
    raise exception 'cannot_invite_self';
  end if;

  insert into race_plan_partners (plan_id, user_id, invited_by)
       values (p_plan, p_user, v_owner)
  on conflict (plan_id, user_id) do nothing;

  select coalesce(p.display_name, 'Athlete'), coalesce(p.locale, 'ko')
    into v_name, v_loc
    from profiles p where p.id = v_owner;

  perform enqueue_notification(
    p_user, 'race_partner',
    case v_loc when 'en' then 'Race partner invite'
               when 'es' then 'Invitación de pareja' else '레이스 파트너 초대' end,
    case v_loc
      when 'en' then v_name || ' invited you to ' || v_title || ' (' || v_date || ').'
      when 'es' then v_name || ' te invitó a ' || v_title || ' (' || v_date || ').'
      else v_name || '님이 ' || v_title || ' (' || v_date || ') 에 함께 나가자고 했어요.'
    end,
    '/schedule');
end;
$$;

revoke all on function public.invite_race_partner(uuid, uuid) from public;
grant execute on function public.invite_race_partner(uuid, uuid) to authenticated;

create or replace function public.respond_race_partner(p_plan uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
  v_name text;
  v_loc text;
begin
  update race_plan_partners
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where plan_id = p_plan
     and user_id = (select auth.uid())
     and status = 'pending';
  if not found then
    raise exception 'no_pending_invite';
  end if;

  select rp.user_id, rp.title into v_owner, v_title
    from race_plans rp where rp.id = p_plan;
  select coalesce(p.display_name, 'Athlete') into v_name
    from profiles p where p.id = (select auth.uid());
  select coalesce(p.locale, 'ko') into v_loc
    from profiles p where p.id = v_owner;

  perform enqueue_notification(
    v_owner, 'race_partner',
    case v_loc when 'en' then 'Race partner' when 'es' then 'Pareja de carrera'
               else '레이스 파트너' end,
    case
      when p_accept then
        case v_loc when 'en' then v_name || ' accepted ' || v_title || '.'
                   when 'es' then v_name || ' aceptó ' || v_title || '.'
                   else v_name || '님이 ' || v_title || ' 참가를 수락했어요.' end
      else
        case v_loc when 'en' then v_name || ' declined ' || v_title || '.'
                   when 'es' then v_name || ' rechazó ' || v_title || '.'
                   else v_name || '님이 ' || v_title || ' 참가를 거절했어요.' end
    end,
    '/schedule');
end;
$$;

revoke all on function public.respond_race_partner(uuid, boolean) from public;
grant execute on function public.respond_race_partner(uuid, boolean) to authenticated;

-- 알림 종류 등록 — 등록되지 않은 종류는 enqueue_notification 이 버린다
insert into public.notification_types (key, description, default_enabled)
     values ('race_partner', '레이스 파트너 초대·응답', true)
on conflict (key) do nothing;

-- ------------------------------------------------------- 내 대회일정 목록
-- 내가 만든 계획 + 내가 파트너로 초대받은 계획을 한 목록으로.
-- 수락하면 그 대회가 내 일정에도 그대로 보여야 한다 — 계획을 복제하지 않고
-- 여기서 합친다.
create or replace function public.my_race_plans()
returns table(id uuid, title text, race_date date, division text, bib text,
              note text, goal_plan_id uuid, race_event_id uuid,
              role text, my_status text, owner_name text, partners jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select rp.id, rp.title, rp.race_date, rp.division, rp.bib, rp.note,
         rp.goal_plan_id, rp.race_event_id,
         case when rp.user_id = (select auth.uid()) then 'owner' else 'partner' end,
         case when rp.user_id = (select auth.uid()) then null
              else (select pp.status from race_plan_partners pp
                     where pp.plan_id = rp.id
                       and pp.user_id = (select auth.uid())) end,
         coalesce(op.display_name, 'Athlete'),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'user_id', pp.user_id,
                     'name', coalesce(pr.display_name, 'Athlete'),
                     'status', pp.status)
                   order by pp.created_at)
                     from race_plan_partners pp
                     join profiles pr on pr.id = pp.user_id
                    where pp.plan_id = rp.id), '[]'::jsonb)
    from race_plans rp
    join profiles op on op.id = rp.user_id
   where (select auth.uid()) is not null
     and (
       rp.user_id = (select auth.uid())
       or exists (select 1 from race_plan_partners pp
                   where pp.plan_id = rp.id
                     and pp.user_id = (select auth.uid())
                     and pp.status in ('pending', 'accepted'))
     )
   order by rp.race_date;
$$;

grant execute on function public.my_race_plans() to anon, authenticated;

-- 검증
do $$
declare
  v_a uuid; v_b uuid; v_plan uuid; v_n int; v_status text;
begin
  select id into v_a from profiles order by created_at limit 1;
  select id into v_b from profiles where id <> v_a order by created_at limit 1;
  if v_b is null then raise notice 'need two profiles — skipping'; return; end if;

  insert into race_plans (user_id, title, race_date, division)
       values (v_a, '__guard__', current_date + 30, 'doubles')
    returning id into v_plan;

  -- 소유자가 초대
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  perform invite_race_partner(v_plan, v_b);

  -- 초대받은 사람 목록에 pending 으로 잡힌다
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  select count(*) into v_n from my_race_plans() where id = v_plan;
  if v_n <> 1 then raise exception 'invitee cannot see the plan'; end if;
  select my_status into v_status from my_race_plans() where id = v_plan;
  if v_status <> 'pending' then raise exception 'expected pending, got %', v_status; end if;

  -- 수락
  perform respond_race_partner(v_plan, true);
  select my_status into v_status from my_race_plans() where id = v_plan;
  if v_status <> 'accepted' then raise exception 'expected accepted, got %', v_status; end if;

  -- 남남은 이 계획을 보지 못한다
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_n from my_race_plans() where id = v_plan;
  if v_n <> 0 then raise exception 'anon sees the plan'; end if;

  raise exception '__guard_rollback__';
exception when others then
  if sqlerrm <> '__guard_rollback__' then raise; end if;
end $$;
