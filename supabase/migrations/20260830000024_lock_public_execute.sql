-- ============================================================
-- Roxlogy — 시스템 감사 수리 (12) 함수 실행 권한 실제 잠금
--
-- 정정: 20260830000013 에서 `alter default privileges … revoke execute on
-- functions from public` 로 신규 함수가 fail-closed 가 됐다고 봤는데,
-- 실증해 보니 **적용되지 않았다**. 그 뒤 만든 app_today()·retry_failed_ai()
-- 는 여전히 PUBLIC EXECUTE 를 갖고 생성됐다(anon 도 PUBLIC 의 구성원이므로
-- 익명 호출 가능). anon/authenticated 기본 권한 회수는 정상 동작했다.
--
-- 신뢰할 수 있는 방법은 이벤트 트리거다: public 스키마에 함수가 생기면
-- 곧바로 PUBLIC 권한을 회수한다. anon/authenticated 는 건드리지 않는다 —
-- `create or replace` 로 기존 RPC 를 갱신할 때 명시 grant 를 벗기면 안 되고,
-- 신규 함수에는 기본 권한 자체가 없어 이미 닫혀 있기 때문이다.
--
-- 함께: 기존 public 스키마 함수 83개의 잉여 PUBLIC 권한도 회수한다
-- (클라이언트가 쓰는 66개는 명시 anon/authenticated grant 로 그대로 동작).
-- 확장(pg_trgm 등) 소속 함수는 인덱스·연산자가 쓰므로 제외.
-- ============================================================

create or replace function public.rox_lock_new_functions()
returns event_trigger
language plpgsql as $fn$
declare r record;
begin
  for r in select * from pg_event_trigger_ddl_commands()
           where command_tag = 'CREATE FUNCTION' and schema_name = 'public'
  loop
    execute format('revoke execute on function %s from public', r.object_identity);
  end loop;
end $fn$;

comment on function public.rox_lock_new_functions() is
  'public 스키마 신규 함수의 PUBLIC EXECUTE 를 즉시 회수 (fail-closed). 클라이언트 RPC 는 정의 뒤 명시적으로 anon/authenticated 에 grant 할 것.';

drop event trigger if exists rox_lock_new_functions_trg;
create event trigger rox_lock_new_functions_trg
  on ddl_command_end when tag in ('CREATE FUNCTION')
  execute function public.rox_lock_new_functions();

-- 기존 함수 일괄 정리 (확장 소속 제외)
do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
    where p.proacl::text ~ '(\{|,)=X/'          -- 빈 grantee = PUBLIC
      and not exists (select 1 from pg_depend d
                      where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public', r.sig);
    n := n + 1;
  end loop;
  raise notice 'revoked PUBLIC execute on % functions', n;
end $$;

-- 가드: public 스키마(확장 제외)에 PUBLIC EXECUTE 가 남아 있으면 실패
do $$
declare v_left int;
begin
  select count(*) into v_left
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace and ns.nspname = 'public'
  where p.proacl::text ~ '(\{|,)=X/'
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  if v_left > 0 then
    raise exception '% functions still grant EXECUTE to PUBLIC', v_left;
  end if;
end $$;
