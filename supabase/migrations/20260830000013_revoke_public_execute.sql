-- ============================================================
-- Roxlogy — 시스템 감사 수리 (1-b) PUBLIC 실행 권한까지 회수
--
-- 20260830000012 는 anon·authenticated 의 명시 grant 만 회수했는데,
-- 함수는 생성 시 PostgreSQL 기본값으로 PUBLIC 에 EXECUTE 가 붙는다.
-- anon 도 PUBLIC 의 구성원이므로 _mcp_insert_workouts 는 여전히
-- 익명 호출이 가능한 상태였다(소유권 검사 없이 임의 program_day 에
-- 워크아웃 주입). PUBLIC 기본 권한까지 닫는다.
--
-- 트리거 함수는 실행 시점이 아니라 CREATE TRIGGER 시점에 권한을
-- 검사하므로 PUBLIC 회수가 트리거 동작에 영향을 주지 않는다.
-- ============================================================

revoke execute on function public._mcp_insert_workouts(uuid, jsonb) from public;

-- 앞으로 만드는 함수도 PUBLIC 기본 실행 권한 없음 (fail-closed)
-- ⚠ 클라이언트가 호출할 RPC 는 정의 직후 반드시 명시적으로 grant 할 것:
--    grant execute on function public.<name>(<args>) to anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

do $$
begin
  if exists (
    select 1 from information_schema.routine_privileges r
    join pg_proc p on p.proname = r.routine_name
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where r.specific_schema = 'public'
      and r.specific_name = p.proname || '_' || p.oid
      and r.grantee in ('anon', 'authenticated', 'PUBLIC')
      and p.proname in ('enqueue_notification', 'enqueue_wod_reminders',
                        '_mcp_insert_workouts')) then
    raise exception 'dangerous definer functions still reachable by clients';
  end if;
end $$;
