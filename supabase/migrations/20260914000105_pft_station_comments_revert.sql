-- ============================================================
-- Roxlogy — 104 의 PFT 구간 컬럼 주석을 되돌린다
--
-- 104 는 어떤 포스터 이미지를 근거로 "4번은 두 번째 런, 6번은 덤벨 스러스터" 라고
-- 주석을 달았는데, **그 이미지 내용이 틀렸다**(2026-09-14 사용자 확인). 종목표는
-- 원래대로 1000m 런 → 버피 브로드 점프 → 런지 → 1000m 로우 → 푸시업 → 월볼 이다.
--
-- 104 파일은 이미 적용된 이력이라 지우지 않는다(마이그레이션은 덧붙이기만 한다).
-- 여기서 주석만 걷어 104 이전 상태(주석 없음)로 되돌린다.
-- ============================================================

comment on column public.pft_results.run_ms is null;
comment on column public.pft_results.burpee_ms is null;
comment on column public.pft_results.lunge_ms is null;
comment on column public.pft_results.row_ms is null;
comment on column public.pft_results.pushup_ms is null;
comment on column public.pft_results.wallball_ms is null;

-- 가드 ----------------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n
    from pg_description d
    join pg_attribute a on a.attrelid = d.objoid and a.attnum = d.objsubid
   where d.objoid = 'public.pft_results'::regclass
     and a.attname in ('run_ms','burpee_ms','lunge_ms','row_ms','pushup_ms','wallball_ms');
  if v_n <> 0 then raise exception '가드: 구간 컬럼 주석이 남아 있다 (%)', v_n; end if;
end $$;
