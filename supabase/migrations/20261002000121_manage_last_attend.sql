-- ============================================================
-- Roxlogy — 관리 > 멤버: 최종 출석일과 경과 일수 (2026-10-02)
--
-- 회원별 마지막 출석(출석 체크된, 취소되지 않은 모임의 시작 시각)과 오늘(KST, app_today)
-- 까지 며칠 지났는지. crew_manage_roster 의 반환 모양을 바꾸면 함수를 지우고 다시
-- 만들어야 하고 배포와 원자적이지 않아서, 같은 권한(운영진·관리자)의 별도 RPC 로 둔다.
-- 웹은 명단과 함께 Promise.all 로 읽어 user_id 로 붙인다.
-- 되돌리기: 이 함수만 지우면 된다(다른 곳에서 쓰지 않음).
-- ============================================================

create or replace function public.crew_manage_last_attend(p_slug text)
returns table(user_id uuid, last_attended_at timestamptz, days_since integer)
language sql stable security definer set search_path to 'public' as $$
  select r.user_id,
         max(e.starts_at),
         -- 미리 체크한 앞으로의 모임은 0일로 본다
         greatest(app_today() - max((e.starts_at at time zone 'Asia/Seoul')::date), 0)
  from crews c
  join crew_events e on e.crew_id = c.id and e.cancelled_at is null
  join crew_event_rsvps r on r.event_id = e.id and r.checked_in_at is not null
  join crew_members m on m.crew_id = c.id and m.user_id = r.user_id
  where c.slug = p_slug and ((select is_crew_staff(c.id)) or (select is_admin()))
  group by r.user_id;
$$;
grant execute on function public.crew_manage_last_attend(text) to authenticated;

-- ---------- 가드 -----------------------------------------------------------------
-- 운영진은 읽고, 크루 밖 사람은 빈 결과. 값은 출석 기록의 최댓값과 같아야 한다.
do $$
declare
  v_crew uuid; v_slug text; v_owner uuid; v_out uuid; n int; v_bad int;
begin
  if has_function_privilege('anon', 'public.crew_manage_last_attend(text)', 'execute') then
    raise exception '가드: 최종 출석 조회가 익명 실행 가능합니다';
  end if;
  select c.id, c.slug, m.user_id into v_crew, v_slug, v_owner
    from crews c join crew_members m on m.crew_id = c.id and m.role = 'owner' and m.status = 'active'
   where exists (select 1 from crew_events e join crew_event_rsvps r on r.event_id = e.id
                  where e.crew_id = c.id and r.checked_in_at is not null)
   limit 1;
  if v_crew is null then raise notice '가드 건너뜀: 출석 기록 있는 크루 없음'; return; end if;
  select p.id into v_out from profiles p
   where not exists (select 1 from crew_members m where m.crew_id = v_crew and m.user_id = p.id)
     and not coalesce(p.is_admin, false) limit 1;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
    select count(*) into n from crew_manage_last_attend(v_slug);
    if n = 0 then raise exception '가드: 운영진이 최종 출석을 못 읽음'; end if;
    select count(*) into v_bad from crew_manage_last_attend(v_slug) x
     where x.days_since < 0
        or x.last_attended_at <> (select max(e.starts_at) from crew_events e
                                    join crew_event_rsvps r on r.event_id = e.id
                                   where e.crew_id = v_crew and e.cancelled_at is null
                                     and r.user_id = x.user_id and r.checked_in_at is not null);
    if v_bad > 0 then raise exception '가드: 최종 출석 값이 출석 기록과 다름 (%건)', v_bad; end if;

    if v_out is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_out::text, 'role', 'authenticated')::text, true);
      select count(*) into n from crew_manage_last_attend(v_slug);
      if n <> 0 then raise exception '가드: 크루 밖 사람이 최종 출석을 읽음'; end if;
    end if;

    perform set_config('request.jwt.claims', null, true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
