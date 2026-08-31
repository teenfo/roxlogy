-- Roxlogy — 믹스 디비전을 어디서나 허용 (profiles 제약 드리프트 정리)
--
-- sessions·goal_plans 는 mixed_doubles·mixed_relay 를 허용하는데 profiles 만
-- 옛 목록(open/pro/doubles/pro_doubles/relay)에 멈춰 있었다. 믹스 더블이 주
-- 디비전인 사용자는 프로필에 자기 디비전을 저장할 수 없다.
-- 목록의 단일 출처는 web/lib/divisions.ts — 그것과 일치시킨다.

alter table public.profiles drop constraint if exists profiles_division_check;
alter table public.profiles add constraint profiles_division_check
  check (division is null or division = any (array[
    'open', 'pro', 'doubles', 'mixed_doubles',
    'pro_doubles', 'relay', 'mixed_relay'
  ]));

comment on column public.profiles.division is
  '주 디비전. 허용 값은 web/lib/divisions.ts(DIVISIONS)와 동일하게 유지할 것.';

-- 가드: 세 테이블의 허용 목록이 서로 어긋나면 실패한다
do $$
declare
  want text[] := array['open','pro','doubles','mixed_doubles',
                       'pro_doubles','relay','mixed_relay'];
  t text; def text; missing text;
begin
  foreach t in array array['profiles','sessions','goal_plans'] loop
    select pg_get_constraintdef(c.oid) into def
    from pg_constraint c join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public' and r.relname = t and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%division%'
    limit 1;
    if def is null then
      raise exception '% 에 division 체크 제약이 없다', t;
    end if;
    select string_agg(v, ', ') into missing
    from unnest(want) as v where def not like '%''' || v || '''%';
    if missing is not null then
      raise exception '%.division 제약에 빠진 값: %', t, missing;
    end if;
  end loop;
end $$;
