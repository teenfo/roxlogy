-- ============================================================
-- Roxlogy — PFT 구간 컬럼에 실제 종목을 주석으로 박는다
--
-- 공식 종목표를 다시 확인했더니(2026-09-14) 4번과 6번이 처음부터 잘못 들어가 있었다.
-- 실제는 1000m 런 → 버피 브로드 점프 50 → 스테이셔너리 런지 100 → **1000m 런** →
-- 핸드 릴리즈 푸시업 30 → **덤벨 스러스터 100** 인데, 컬럼을 row_ms / wallball_ms 로
-- 지어 놨다.
--
-- **컬럼 이름은 바꾸지 않는다.** PFT 는 순서가 고정이라 "4번째 구간의 시간"이라는 의미는
-- 그대로여서 저장된 값이 전부 유효하고, 이름을 바꾸면 RPC 반환 모양이 달라져 배포와
-- 원자적이지 않다(CLAUDE.md 보안 규칙). 화면 표시만 고치고 여기에는 주석을 남긴다 —
-- 나중에 이 테이블을 보는 사람이 "로우?" 하고 헷갈리지 않게.
--
-- 배지 컷오프는 공식 기준과 이미 일치한다(45세 미만 22/26분, 45세 이상 24/28분).
-- ============================================================

comment on column public.pft_results.run_ms is '1번째 구간 — 1000m 런';
comment on column public.pft_results.burpee_ms is '2번째 구간 — 버피 브로드 점프 50회';
comment on column public.pft_results.lunge_ms is '3번째 구간 — 스테이셔너리 런지 100회';
comment on column public.pft_results.row_ms is
  '4번째 구간 — 두 번째 1000m 런. 컬럼 이름(row)은 옛 이름이다(로우가 아니다).';
comment on column public.pft_results.pushup_ms is '5번째 구간 — 핸드 릴리즈 푸시업 30회';
comment on column public.pft_results.wallball_ms is
  '6번째 구간 — 덤벨 스러스터 100회(2×4/6kg). 컬럼 이름(wallball)은 옛 이름이다.';

-- 가드 ----------------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n
    from pg_description d
    join pg_attribute a on a.attrelid = d.objoid and a.attnum = d.objsubid
   where d.objoid = 'public.pft_results'::regclass
     and a.attname in ('run_ms','burpee_ms','lunge_ms','row_ms','pushup_ms','wallball_ms');
  if v_n <> 6 then raise exception '가드: 구간 컬럼 주석이 6개가 아니다 (%)', v_n; end if;

  -- 배지 컷오프가 공식 기준과 같은지 — 생성 컬럼 식에 네 값이 다 있어야 한다
  if not exists (
    select 1 from pg_attrdef d
      join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
     where d.adrelid = 'public.pft_results'::regclass and a.attname = 'badge'
       and pg_get_expr(d.adbin, d.adrelid) like '%1320000%'
       and pg_get_expr(d.adbin, d.adrelid) like '%1560000%'
       and pg_get_expr(d.adbin, d.adrelid) like '%1440000%'
       and pg_get_expr(d.adbin, d.adrelid) like '%1680000%'
  ) then
    raise exception '가드: 배지 컷오프가 공식 기준(22/26 · 24/28분)과 다르다';
  end if;
end $$;
