-- ============================================================
-- Roxlogy — 일정 목록 아바타 스택용 참석자 이름
--
-- crew_calendar 는 going_count(인원수)만 준다. 디자인 핸드오프는 목록에서
-- 참석자 얼굴(이니셜 아바타)을 보여준다.
--
-- crew_calendar 를 고치지 않고 새 함수로 둔다 — 기존 RPC 의 반환 모양을 바꾸면
-- 마이그레이션(즉시)과 Vercel 배포(1~2분) 사이에 옛 번들이 깨진다 (CLAUDE.md,
-- 2026-09-10 장애). 새 함수는 옛 코드가 부르지 않으므로 순서를 타지 않는다.
--
-- 가시성은 crew_events 와 같은 규칙을 그대로 쓴다 — 정회원 전용 모임은 자격
-- 없는 사람에게 애초에 행이 없다. 이름 자체는 이미 모임 상세에서 공개된다.
-- ============================================================

create or replace function public.crew_month_going_names(
  p_slug text, p_from date, p_to date
)
returns table(event_id uuid, names text[])
language sql stable security definer set search_path to 'public' as $fn$
  select e.id,
         coalesce((
           select array_agg(coalesce(pr.display_name, 'Athlete') order by r.created_at)
           from crew_event_rsvps r
           join profiles pr on pr.id = r.user_id
           where r.event_id = e.id and r.status = 'going'), '{}')
  from crew_events e
  join crews c on c.id = e.crew_id
  where c.slug = p_slug
    and e.cancelled_at is null
    and (e.starts_at at time zone 'Asia/Seoul')::date between p_from and p_to
    and (c.is_public or is_crew_member(c.id))
    and (not e.members_only or is_crew_full_member(e.crew_id));
$fn$;

grant execute on function public.crew_month_going_names(text, date, date)
  to anon, authenticated;

-- 가드 ------------------------------------------------------------------------
do $guard$
declare v_slug text; v_n int; v_mo int;
begin
  select c.slug into v_slug from crews c where c.is_public limit 1;
  if v_slug is null then return; end if;

  perform set_config('request.jwt.claims', '', true);
  -- 익명에게 정회원 전용 모임은 애초에 안 나와야 한다
  select count(*) into v_mo
    from crew_month_going_names(v_slug, app_today() - 365, app_today() + 365) g
    join crew_events e on e.id = g.event_id
   where e.members_only;
  if v_mo <> 0 then
    raise exception '가드: 익명에게 정회원 전용 모임이 나왔습니다 (%건)', v_mo;
  end if;

  select count(*) into v_n
    from crew_month_going_names(v_slug, app_today() - 365, app_today() + 365);
  if v_n = 0 then
    raise exception '가드: 공개 모임이 하나도 안 나왔습니다';
  end if;
end $guard$;
