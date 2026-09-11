-- ============================================================
-- Roxlogy — MCP 토큰 재발급·폐기 전용 RPC (감사 2026-09-11 A01)
--
-- 문제
--   설정 화면의 "토큰 재발급"이 profiles.mcp_token 을 클라이언트 UPDATE 로
--   바꿨다. 그런데 042 의 profiles_privileged_guard 는 mcp_token 변경을
--   관리자에게도 막는다(profile_token_locked) — 클라이언트가 값을 고를 수
--   있으면 예측 가능한 토큰을 심을 수 있기 때문이다. 결과: 버튼을 눌러도
--   옛 토큰이 그대로 남고, UI 는 오류를 표시하지 않았다. 유출된 토큰을
--   사용자가 스스로 회수할 길이 없었다.
--
-- 해결
--   값을 서버가 만드는 SECURITY DEFINER RPC 두 개. 둘 다 auth.uid() 본인만.
--   mcp_token_regen()  : 32바이트 난수(hex 64자)로 즉시 교체하고 새 값을 반환
--   mcp_token_revoke() : null 로 지워 연결 자체를 끊는다(재발급 전까지 접근 불가)
--   가드는 손대지 않는다. 가드가 애초에 "재발급 전용 경로"를 위해 열어 둔
--   rox.profile_bypass 플래그를 UPDATE 한 문장 동안만 켠다 — 값은 여전히
--   서버만 만들므로 가드의 목적(클라이언트가 값을 고르지 못함)은 그대로다.
--
-- 정지 계정(profiles.disabled)
--   정지 직후에도 access JWT 는 만료(최대 1시간)까지 살아 있다. 그 사이 정지
--   사용자가 PostgREST 로 이 RPC 를 불러 086 이 회수한 토큰을 되살리면 안 되므로
--   재발급 UPDATE 는 `and not disabled` 로 묶고 account_disabled 를 던진다.
--   폐기(null)는 언제나 안전한 방향이라 정지 여부를 보지 않는다 — 086 의 회수도
--   같은 값(null)을 쓴다. 086 없이도 이 파일 혼자 성립한다.
--
-- 폐기 상태를 표현하려고 mcp_token 의 not null 을 푼다. 조회 경로는 전부
--   `mcp_token = p_token` 비교라 null 행은 어떤 토큰에도 매치되지 않는다.
--   (기본값 encode(gen_random_bytes(24),'hex') 는 그대로 — 새 계정은 여전히
--   토큰을 갖고 시작한다. 쓰기 범위는 085 에서 따로 다룬다.)
--
-- 되돌리기
--   drop function public.mcp_token_regen(); drop function public.mcp_token_revoke();
--   update profiles set mcp_token = encode(gen_random_bytes(24),'hex') where mcp_token is null;
--   alter table public.profiles alter column mcp_token set not null;
-- ============================================================

alter table public.profiles alter column mcp_token drop not null;

-- 1) 재발급 ---------------------------------------------------------------
create or replace function public.mcp_token_regen()
returns text
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_new text;
  v_n int;
begin
  if v_uid is null then raise exception 'auth_required'; end if;

  -- 기존 24바이트보다 길게(32바이트 = hex 64자). 값은 서버만 만든다.
  -- search_path 가 public 뿐이라 pgcrypto 는 스키마를 붙여 부른다.
  v_new := encode(extensions.gen_random_bytes(32), 'hex');

  -- profiles_privileged_guard 는 mcp_token 변경을 무조건 막는다. 여기가 그
  -- 가드가 전제한 재발급 전용 경로이므로 이 UPDATE 한 문장 동안만 bypass 를
  -- 켠다. 트랜잭션 로컬(is_local=true)이라 예외로 빠져나가도 새지 않는다.
  perform set_config('rox.profile_bypass', '1', true);
  update profiles set mcp_token = v_new where id = v_uid and not disabled;
  get diagnostics v_n = row_count;
  perform set_config('rox.profile_bypass', '', true);

  if v_n <> 1 then
    -- 정지 계정은 회수된 토큰을 되살릴 수 없다(086 과 짝). 그 외 0행은 프로필 없음.
    if exists (select 1 from profiles where id = v_uid and disabled) then
      raise exception 'account_disabled';
    end if;
    raise exception 'profile_not_found';
  end if;
  return v_new;
end;
$$;
revoke all on function public.mcp_token_regen() from public;
grant execute on function public.mcp_token_regen() to authenticated;

-- 2) 폐기 -----------------------------------------------------------------
create or replace function public.mcp_token_revoke()
returns boolean
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if v_uid is null then raise exception 'auth_required'; end if;

  -- 정지 계정도 폐기는 허용한다 — null 은 086 의 회수와 같은 값이라 안전한 방향이다.
  perform set_config('rox.profile_bypass', '1', true);
  update profiles set mcp_token = null where id = v_uid;
  get diagnostics v_n = row_count;
  perform set_config('rox.profile_bypass', '', true);

  if v_n <> 1 then raise exception 'profile_not_found'; end if;
  return true;
end;
$$;
revoke all on function public.mcp_token_revoke() from public;
grant execute on function public.mcp_token_revoke() to authenticated;

-- 가드 ----------------------------------------------------------------------
-- 실제 사용자 토큰으로 검증하므로 끝에 반드시 되돌린다(__guard_rollback__).
do $$
declare
  v_uid uuid; v_old text; v_new text;
begin
  -- 086 의 mcp_uid 는 정지 계정에 null 을 주므로 활성 프로필로 고른다(적용 순서와 무관하게 통과)
  select id, mcp_token into v_uid, v_old
    from public.profiles where mcp_token is not null and not disabled limit 1;
  if v_uid is null then return; end if;

  -- (a) 로그인 없는 호출은 거부
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.mcp_token_regen();
    raise exception '가드: 로그인 없이 토큰이 재발급됩니다';
  exception when others then
    if sqlerrm not like '%auth_required%' then raise; end if;
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  -- (b) 재발급: 새 토큰은 되고 옛 토큰은 거부
  v_new := public.mcp_token_regen();
  if v_new is null or length(v_new) <> 64 or v_new = v_old then
    raise exception '가드: 재발급된 토큰이 이상합니다 (len=%)', coalesce(length(v_new)::text, 'null');
  end if;
  if public.mcp_uid(v_new) is distinct from v_uid then
    raise exception '가드: 새 토큰으로 사용자를 찾지 못합니다';
  end if;
  if public.mcp_uid(v_old) is not null then
    raise exception '가드: 옛 토큰이 아직 유효합니다';
  end if;

  -- (c) 가드는 약화되지 않았다 — 같은 사용자의 직접 UPDATE 는 여전히 막힌다
  begin
    update public.profiles set mcp_token = 'x' || gen_random_uuid()::text where id = v_uid;
    raise exception '가드: mcp_token 이 클라이언트에서 변경 가능합니다';
  exception when others then
    if sqlerrm not like '%profile_token_locked%' then raise; end if;
  end;

  -- (d) 폐기: 토큰이 비고 접근이 끊긴다
  perform public.mcp_token_revoke();
  if (select mcp_token from public.profiles where id = v_uid) is not null
     or public.mcp_uid(v_new) is not null then
    raise exception '가드: 폐기 후에도 토큰이 남아 있습니다';
  end if;

  -- (e) 정지 계정은 재발급 불가 — 회수된 토큰이 정지 사용자의 살아 있는 JWT 로 되살아나면 안 된다.
  --     disabled 변경은 privileged_guard 가 비관리자 JWT 에 막으므로 JWT 를 비운 채(신뢰 경계) 바꾼다.
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set disabled = true where id = v_uid;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  begin
    perform public.mcp_token_regen();
    raise exception '가드: 정지 계정이 토큰을 재발급합니다';
  exception when others then
    if sqlerrm not like '%account_disabled%' then raise; end if;
  end;
  if (select mcp_token from public.profiles where id = v_uid) is not null then
    raise exception '가드: 정지 계정의 재발급이 거부됐는데 토큰이 생겼습니다';
  end if;

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
