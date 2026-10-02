-- ============================================================
-- Roxlogy — 레이스 참가 목록에 "코드 참가 꺼진 내 크루 레이스"도 보이게 (2026-10-02)
--
-- 그동안 pft_race_joinable 은 코드 참가가 켜진(join_open) 레이스만 돌려줘서, 운영진이
-- 코드 참가를 끄면 크루원의 "레이스 참가" 화면이 텅 비었다(무슨 레이스가 있는지도 모름).
-- 이제 진행 중인 내 크루 레이스는 코드 참가가 꺼져 있어도 목록에 넣고 join_open 을 같이 준다.
-- 화면은 꺼진 레이스에 참가 버튼 대신 "운영진이 참가자를 추가하는 레이스" 안내를 띄운다
-- (web components/pft-race-pick.tsx — 이 마이그레이션보다 먼저 배포됨).
-- 크루 없는 공개 레이스는 예전처럼 코드 참가가 켜진 것만. 참가 판정(pft_race_join)은 그대로.
-- 반환은 jsonb 배열에 키 하나(join_open) 추가뿐. 순서: 참가 가능한 것 → 내가 들어간 것 → 꺼진 것.
-- 되돌리기: 마이그레이션 114 의 pft_race_joinable 정의를 다시 적용.
-- ============================================================

create or replace function public.pft_race_joinable()
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'code', s.code, 'title', s.title, 'created_at', s.created_at,
             'crew', s.crew, 'crew_slug', s.crew_slug,
             'entries', s.entries, 'joined', s.joined,
             'format', s.format, 'checkpoints', s.checkpoints,
             'join_open', s.join_open)
           order by (not s.join_open and not s.joined), s.joined, s.created_at desc)
    from (
      select r.id, r.code, r.title, r.created_at, c.name as crew, c.slug as crew_slug,
             r.format, r.checkpoints, r.join_open,
             (select count(*) from pft_race_entries e where e.race_id = r.id) as entries,
             exists (select 1 from pft_race_entries e where e.race_id = r.id and e.user_id = v_uid) as joined
      from pft_races r left join crews c on c.id = r.crew_id
      where r.status = 'open'
        and ((r.crew_id is null and r.join_open)
             or exists (select 1 from crew_members m
                         where m.crew_id = r.crew_id and m.user_id = v_uid and m.status = 'active'))
      order by r.created_at desc
      limit 50) s), '[]'::jsonb);
end; $$;
grant execute on function public.pft_race_joinable() to authenticated;

-- ---------- 가드 -----------------------------------------------------------------
-- 크루원 시점: 코드 참가를 끈 진행 중 크루 레이스가 join_open=false 로 보이는지 확인 후 되감는다.
do $$
declare v_race uuid; v_crew uuid; v_member uuid; j jsonb;
begin
  if has_function_privilege('anon', 'public.pft_race_joinable()', 'execute') then
    raise exception '가드: 참가 목록이 익명 실행 가능합니다';
  end if;
  select r.id, r.crew_id into v_race, v_crew from pft_races r
   where r.status = 'open' and r.crew_id is not null order by r.created_at desc limit 1;
  if v_race is null then raise notice '가드 건너뜀: 진행 중 크루 레이스 없음'; return; end if;
  select m.user_id into v_member from crew_members m where m.crew_id = v_crew and m.status = 'active' limit 1;
  if v_member is null then raise notice '가드 건너뜀: 크루원 없음'; return; end if;

  begin
    update pft_races set join_open = false where id = v_race;
    perform set_config('request.jwt.claims', json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
    j := pft_race_joinable();
    if not exists (select 1 from jsonb_array_elements(j) x
                    where x->>'id' = v_race::text and (x->>'join_open')::boolean = false) then
      raise exception '가드: 코드 참가 꺼진 크루 레이스가 목록에 없음 %', j;
    end if;
    perform set_config('request.jwt.claims', null, true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
