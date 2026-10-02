-- ============================================================
-- Roxlogy — 장기 미출석 경고 기준 일수(크루별) (2026-10-02)
--
-- 관리 > 멤버의 "최종 출석" 칸은 마지막 출석 후 이 일수 이상 지난 회원을 강조한다.
-- 기본 30일, 1~365일. 운영진이 멤버 화면에서 바꾼다 — 쓰기 권한은 기존 crews 수정
-- 정책(crews_update_staff: 운영진·관리자)을 그대로 따른다.
-- 칸 추가만이라 옛 코드는 무시하고 지나간다. 단, 새 웹 코드가 이 칸을 읽으므로 이
-- 마이그레이션을 먼저 적용한 뒤 배포한다.
-- 되돌리기: alter table crews 에서 이 칸을 빼고, 웹의 absence_warn_days 참조를 걷어낸다.
-- ============================================================

alter table public.crews
  add column if not exists absence_warn_days smallint not null default 30;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crews_absence_warn_days_range') then
    alter table public.crews
      add constraint crews_absence_warn_days_range check (absence_warn_days between 1 and 365);
  end if;
end $$;

-- ---------- 가드 -----------------------------------------------------------------
-- 운영진은 바꿀 수 있고, 범위 밖 값은 거부, 크루 밖 사람은 못 바꾼다 — 확인 후 되감는다.
do $$
declare
  v_crew uuid; v_owner uuid; v_out uuid; v_val smallint; n int;
begin
  select c.id, m.user_id into v_crew, v_owner
    from crews c join crew_members m on m.crew_id = c.id and m.role = 'owner' and m.status = 'active'
   limit 1;
  if v_crew is null then raise notice '가드 건너뜀: 크루장 있는 크루 없음'; return; end if;
  select p.id into v_out from profiles p
   where not exists (select 1 from crew_members m where m.crew_id = v_crew and m.user_id = p.id)
     and not coalesce(p.is_admin, false) limit 1;

  begin
    -- RLS 를 실제로 타게 authenticated 역할로 바꿔 실행한다
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update crews set absence_warn_days = 14 where id = v_crew;
    reset role;
    select absence_warn_days into v_val from crews where id = v_crew;
    if v_val <> 14 then raise exception '가드: 운영진이 경고 기준을 못 바꿈 (%)', v_val; end if;

    begin
      update crews set absence_warn_days = 0 where id = v_crew;
      raise exception '가드: 범위 밖 값(0)이 들어감';
    exception when check_violation then null;
    end;

    if v_out is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', v_out::text, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update crews set absence_warn_days = 99 where id = v_crew;
      get diagnostics n = row_count;
      reset role;
      if n <> 0 then raise exception '가드: 크루 밖 사람이 경고 기준을 바꿈'; end if;
    end if;

    perform set_config('request.jwt.claims', null, true);
    raise exception 'guard_ok';
  exception when raise_exception then
    reset role;
    perform set_config('request.jwt.claims', null, true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
