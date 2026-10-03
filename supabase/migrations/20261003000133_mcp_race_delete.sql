-- ============================================================
-- Roxlogy — MCP: 레이스 삭제 (2026-10-03)
--
-- 마이그레이션 132(레이스 수정 + MCP 도구)와 짝. 행을 지우는 함수라 Supabase MCP 커넥터로는
-- 적용이 취소되어(CLAUDE.md "운영 DB 적용 경로") SQL Editor 에서 실행한다.
--   _pft_race_delete(race)                          — 내부(grant 없음)
--   mcp_timing_race_delete(token, code, confirm)    — 쓰기 토큰 + 레이스 운영진 + 확인 코드 일치
-- 지우면 참가 기록(pft_race_entries)과 조 설명(pft_race_waves)이 함께 사라진다(FK cascade).
-- 선수 개인의 PFT 결과(pft_results)·세션(sessions)은 본인 기록이라 남긴다(엔트리 연결만 끊긴다).
-- 확인 코드(confirm_code)가 레이스 코드와 같아야 지운다 — 잘못된 레이스를 지우는 사고 방지.
-- 신설만 — 배포 순서 무관. 되돌리기: 두 함수를 없앤다(지운 레이스는 되돌릴 수 없다).
-- ============================================================

create or replace function public._pft_race_delete(p_race uuid)
returns void
language sql security definer set search_path to 'public' as $$
  delete from pft_races where id = p_race;
$$;
revoke all on function public._pft_race_delete(uuid) from public, anon, authenticated;

create or replace function public.mcp_timing_race_delete(p_token text, p_code text, p_confirm_code text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare g record; r record; v_entries int;
begin
  select * into g from _mcp_race_gate(p_token, p_code, true);
  if g.uid is null then return null; end if;
  if g.err is not null then return g.err; end if;
  if not pft_race_can_manage(g.race_id) then return jsonb_build_object('error', 'not_allowed'); end if;
  select * into r from pft_races where id = g.race_id;
  if upper(btrim(coalesce(p_confirm_code, ''))) <> r.code then
    return jsonb_build_object('error', 'confirm_code_mismatch', 'code', r.code);
  end if;
  select count(*) into v_entries from pft_race_entries where race_id = r.id;
  perform _pft_race_delete(r.id);
  return jsonb_build_object('ok', true, 'code', r.code, 'title', r.title, 'entries_removed', v_entries);
end; $$;
grant execute on function public.mcp_timing_race_delete(text, text, text) to anon, authenticated;

-- ---------- 가드 -----------------------------------------------------------------
do $$
declare
  v_slug text; v_staff uuid; j jsonb; v_code text;
  k text := 'guard-race-delete-staff-token-000000001';
begin
  if has_function_privilege('anon', 'public._pft_race_delete(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._pft_race_delete(uuid)', 'execute') then
    raise exception '가드: 레이스 삭제 본체가 클라이언트에 열려 있습니다';
  end if;
  select c.slug, m.user_id into v_slug, v_staff
    from crew_members m join crews c on c.id = m.crew_id and c.status = 'active'
    join profiles pr on pr.id = m.user_id and not pr.disabled
   where m.status = 'active' and m.role in ('owner', 'coach') limit 1;
  if v_staff is null then raise notice '가드 건너뜀: 운영진 없음'; return; end if;

  begin
    perform set_config('rox.profile_bypass', '1', true);
    update profiles set mcp_token = k, mcp_write = true where id = v_staff;
    j := mcp_timing_race_create(k, '가드 삭제', v_slug, 'hyrox_sim', 16, true, null);
    v_code := j->'race'->>'code';
    j := mcp_timing_race_delete(k, v_code, 'XXXXXX');
    if j->>'error' is distinct from 'confirm_code_mismatch' then raise exception '가드: 확인 코드 %', j; end if;
    j := mcp_timing_race_delete(k, v_code, lower(v_code));
    if (j->>'ok')::boolean is not true or exists (select 1 from pft_races where code = v_code) then
      raise exception '가드: 삭제 %', j;
    end if;
    perform set_config('request.jwt.claims', null, true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('rox.profile_bypass', '', true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('rox.profile_bypass', '', true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
