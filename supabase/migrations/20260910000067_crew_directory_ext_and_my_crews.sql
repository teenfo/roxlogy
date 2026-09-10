-- ============================================================
-- Roxlogy — 크루 목록 재디자인용 데이터
--
-- 컬럼 "추가"는 옛 코드가 무시하고 지나가므로 배포 순서를 타지 않는다.
-- 위험한 건 이름·타입을 바꾸거나 없애는 경우다 (CLAUDE.md, 2026-09-10 장애).
--
-- crew_directory += description(카드 소개 2줄), last_active_at(활동 도트),
--                   member_names(아바타 스택)
-- my_crews_overview() 신규 — 목록 상단 "내 크루" 강조 카드(역할·등급·다음 모임)
-- ============================================================

drop function if exists public.crew_directory(integer);

create or replace function public.crew_directory(p_limit integer default 50)
returns table(
  slug text, name text, tagline text, logo_url text, location text,
  join_policy text, member_count bigint, post_count bigint,
  description text, last_active_at timestamptz, member_names text[]
)
language sql stable security definer set search_path to 'public' as $fn$
  select c.slug, c.name, c.tagline, c.logo_url, c.location, c.join_policy,
         (select count(*) from crew_members m where m.crew_id = c.id and m.status = 'active'),
         (select count(*) from crew_posts p where p.crew_id = c.id and p.deleted_at is null),
         c.description,
         -- 마지막 활동 = 글·모임 중 가장 최근. 목록에서 살아 있는 크루를 가린다.
         greatest(
           (select max(p.created_at) from crew_posts p
             where p.crew_id = c.id and p.deleted_at is null),
           (select max(e.created_at) from crew_events e
             where e.crew_id = c.id and e.cancelled_at is null)),
         -- 아바타 스택용 이름 3개 (가입 순 = 코어 멤버)
         coalesce((select array_agg(x.nm) from (
             select coalesce(pr.display_name, 'Athlete') as nm
             from crew_members m join profiles pr on pr.id = m.user_id
             where m.crew_id = c.id and m.status = 'active'
             order by m.joined_at
             limit 3) x), '{}')
  from crews c
  where c.is_public and c.status = 'active'
  order by 7 desc, c.created_at asc
  limit least(coalesce(p_limit, 50), 100);
$fn$;

grant execute on function public.crew_directory(integer) to anon, authenticated;

create or replace function public.my_crews_overview()
returns jsonb
language sql stable security definer set search_path to 'public' as $fn$
  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object(
      'slug', c.slug, 'name', c.name, 'logo_url', c.logo_url,
      'location', c.location, 'tagline', c.tagline,
      'role', m.role,
      'tier', ti.name, 'tier_color', ti.color,
      'member_count', (select count(*) from crew_members m2
                        where m2.crew_id = c.id and m2.status = 'active'),
      'post_count', (select count(*) from crew_posts p
                      where p.crew_id = c.id and p.deleted_at is null),
      'member_names', coalesce((select array_agg(y.nm) from (
          select coalesce(pr.display_name, 'Athlete') as nm
          from crew_members m3 join profiles pr on pr.id = m3.user_id
          where m3.crew_id = c.id and m3.status = 'active'
          order by m3.joined_at limit 4) y), '{}'),
      -- 다음 모임 — 지금 이후 가장 이른 것. 자격 없는 정회원 전용 모임은 제외.
      'next_event', (
        select jsonb_build_object(
          'id', e.id, 'title', e.title, 'starts_at', e.starts_at,
          'going', (select count(*) from crew_event_rsvps r
                     where r.event_id = e.id and r.status = 'going'))
        from crew_events e
        where e.crew_id = c.id and e.cancelled_at is null
          and e.closed_at is null and e.starts_at >= now()
          and (not e.members_only or is_crew_full_member(c.id))
        order by e.starts_at limit 1)
    ) as x
    from crews c
    join crew_members m on m.crew_id = c.id
      and m.user_id = (select auth.uid()) and m.status = 'active'
    left join crew_member_tiers ti on ti.id = m.tier_id
    where c.status = 'active'
  ) q;
$fn$;

grant execute on function public.my_crews_overview() to anon, authenticated;

-- 가드 ------------------------------------------------------------------------
do $guard$
declare v_uid uuid; r record; j jsonb; n int;
begin
  select count(*) into n from crew_directory(50);
  if n = 0 then raise exception '가드: 크루 디렉터리가 비었습니다'; end if;
  select * into r from crew_directory(50) limit 1;
  if r.member_names is null then
    raise exception '가드: member_names 가 null 입니다';
  end if;

  -- 내 크루: 익명이면 빈 배열이어야 한다
  perform set_config('request.jwt.claims', '', true);
  j := public.my_crews_overview();
  if jsonb_array_length(j) <> 0 then
    raise exception '가드: 익명에게 내 크루가 나왔습니다 (%)', j::text;
  end if;

  -- 크루원이면 자기가 속한 수만큼만
  select m.user_id into v_uid from crew_members m where m.status = 'active' limit 1;
  if v_uid is null then return; end if;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid)::text, true);
  j := public.my_crews_overview();
  select count(*) into n from crew_members m
   where m.user_id = v_uid and m.status = 'active';
  if jsonb_array_length(j) <> n then
    raise exception '가드: 내 크루 수가 % 여야 하는데 % 입니다',
      n, jsonb_array_length(j);
  end if;
end $guard$;
