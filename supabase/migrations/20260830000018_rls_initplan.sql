-- ============================================================
-- Roxlogy — 시스템 감사 수리 (6) RLS auth_rls_initplan 최적화
--
-- advisor(performance) auth_rls_initplan 81건: 정책 안의 auth.uid() 가
-- 행마다 재평가된다. (select auth.uid()) 로 감싸면 플래너가 InitPlan 으로
-- 한 번만 계산한다 — auth.uid() 는 STABLE 이라 의미·결과는 동일하다.
--
-- ALTER POLICY 로 표현식만 바꿔 대상 롤·명령(select/insert/…)은 유지한다.
-- 주의: Postgres 는 저장 시 표현식을 정규화해 `( SELECT auth.uid() AS uid)`
-- 형태로 되돌려 준다. 따라서 "이미 감쌌는지"는 문자열 포함이 아니라
-- auth.uid() 총 등장 수와 SELECT auth.uid() 등장 수를 비교해 판정한다
-- (그렇지 않으면 재실행 때 이중으로 감싼다).
-- ============================================================

create or replace function pg_temp.rox_bare_uid_count(expr text)
returns int
language sql immutable as $$
  select case when expr is null then 0 else
    (length(expr) - length(replace(expr, 'auth.uid()', '')))
      / length('auth.uid()')
    -
    (length(upper(expr)) - length(replace(upper(expr), 'SELECT AUTH.UID()', '')))
      / length('SELECT AUTH.UID()')
  end;
$$;

do $$
declare
  r record;
  v_q text;
  v_w text;
  v_n int := 0;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and pg_temp.rox_bare_uid_count(qual)
        + pg_temp.rox_bare_uid_count(with_check) > 0
  loop
    v_q := replace(r.qual, 'auth.uid()', '(select auth.uid())');
    v_w := replace(r.with_check, 'auth.uid()', '(select auth.uid())');
    if r.qual is not null and r.with_check is not null then
      execute format('alter policy %I on %I.%I using (%s) with check (%s)',
                     r.policyname, r.schemaname, r.tablename, v_q, v_w);
    elsif r.qual is not null then
      execute format('alter policy %I on %I.%I using (%s)',
                     r.policyname, r.schemaname, r.tablename, v_q);
    else
      execute format('alter policy %I on %I.%I with check (%s)',
                     r.policyname, r.schemaname, r.tablename, v_w);
    end if;
    v_n := v_n + 1;
  end loop;
  raise notice 'rewrote % policies', v_n;
end $$;

do $$
declare v_left int;
begin
  select count(*) into v_left from pg_policies
  where schemaname = 'public'
    and pg_temp.rox_bare_uid_count(qual)
      + pg_temp.rox_bare_uid_count(with_check) > 0;
  if v_left > 0 then
    raise exception 'bare auth.uid() remains in % policies', v_left;
  end if;
end $$;

-- auth.role() 을 쓰는 정책 2건도 동일하게 InitPlan 화
alter policy exercises_select_all on public.exercises
  using ((select auth.role()) = 'authenticated');
alter policy ntypes_read on public.notification_types
  using ((select auth.role()) = 'authenticated');
