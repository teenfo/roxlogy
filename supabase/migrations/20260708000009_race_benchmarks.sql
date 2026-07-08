-- ============================================================
-- Roxlogy — 009 백분위 랭킹 (S13)
--
-- 공식 결과를 "대량 수집"하지 않는다 (S12 원칙 / 법적 검토 게이트).
-- 대신 공개 익명 집계 분포(공개 데이터셋 기반 대표 CDF)를 저장하고,
-- 사용자 본인 레이스 기록을 그 분포에 비추어 "필드 대비 백분위"만 산출한다.
--
-- race_benchmarks: 디비전×성별×범위(overall/스테이션)별 백분위 브레이크포인트.
--   percentiles = {"p10":ms,"p25":ms,"p50":ms,"p75":ms,"p90":ms,"p99":ms}
--   (완주 시간이므로 값이 작을수록 빠름 → p10이 가장 빠른 축)
-- source/sample_size로 출처를 명시 → 실제 데이터셋 적재 시 교체 가능.
-- ============================================================

create table public.race_benchmarks (
  id           uuid primary key default gen_random_uuid(),
  division     text not null,                 -- 'open','pro','doubles','pro_doubles'
  gender       text not null,                 -- 'male','female','all'
  scope        text not null default 'overall', -- 'overall' | 스테이션 key(추후)
  percentiles  jsonb not null,                -- {"p10":..,"p25":..,"p50":..,"p75":..,"p90":..,"p99":..}
  sample_size  int,
  source       text,
  season       text,
  updated_at   timestamptz not null default now(),
  unique (division, gender, scope, season)
);

-- 공개 익명 집계(개인정보 아님) — 비로그인 포함 전체 읽기. 쓰기는 service role 전용.
alter table public.race_benchmarks enable row level security;
create policy "race_benchmarks_select_all" on public.race_benchmarks
  for select using (true);

-- ------------------------------------------------------------
-- 시드: 공개 집계 기반 대표 분포 v1 (근사치 — 실제 데이터셋으로 정밀화 예정)
-- 값 단위 = ms. HYROX 개인/더블 풀 레이스 완주 시간의 널리 공개된
-- 분포를 근사한 것으로, 절대 순위가 아니라 대략적 위치 파악용.
-- ------------------------------------------------------------
insert into public.race_benchmarks (division, gender, scope, percentiles, sample_size, source, season) values
  ('open','male','overall',
   '{"p10":4320000,"p25":4800000,"p50":5340000,"p75":5940000,"p90":6600000,"p99":7800000}', null,
   'public-aggregate-baseline-v1 (approx)', null),
  ('open','female','overall',
   '{"p10":4920000,"p25":5460000,"p50":6000000,"p75":6660000,"p90":7320000,"p99":8520000}', null,
   'public-aggregate-baseline-v1 (approx)', null),
  ('open','all','overall',
   '{"p10":4560000,"p25":5100000,"p50":5640000,"p75":6300000,"p90":6960000,"p99":8160000}', null,
   'public-aggregate-baseline-v1 (approx)', null),
  ('pro','male','overall',
   '{"p10":3720000,"p25":4080000,"p50":4500000,"p75":4980000,"p90":5520000,"p99":6300000}', null,
   'public-aggregate-baseline-v1 (approx)', null),
  ('pro','female','overall',
   '{"p10":4320000,"p25":4740000,"p50":5220000,"p75":5760000,"p90":6360000,"p99":7200000}', null,
   'public-aggregate-baseline-v1 (approx)', null),
  ('pro','all','overall',
   '{"p10":4020000,"p25":4410000,"p50":4860000,"p75":5370000,"p90":5940000,"p99":6750000}', null,
   'public-aggregate-baseline-v1 (approx)', null),
  ('doubles','all','overall',
   '{"p10":3600000,"p25":3960000,"p50":4380000,"p75":4860000,"p90":5400000,"p99":6180000}', null,
   'public-aggregate-baseline-v1 (approx)', null),
  ('pro_doubles','all','overall',
   '{"p10":3300000,"p25":3660000,"p50":4020000,"p75":4440000,"p90":4920000,"p99":5640000}', null,
   'public-aggregate-baseline-v1 (approx)', null);

-- ------------------------------------------------------------
-- race_percentile: 완주 시간(ms)이 필드에서 어디쯤인지(%).
-- 반환값 = "이 필드의 상위 몇 %인가" (작을수록 빠름/좋음).
--   예) 20 → 상위 20% (필드의 80%보다 빠름)
-- CDF 브레이크포인트(p10..p99)를 시간 축으로 선형보간해 산출.
-- gender 정확 매칭 없으면 'all'로 폴백. 데이터 없으면 null.
-- ------------------------------------------------------------
create or replace function public.race_percentile(
  p_total_ms bigint,
  p_division text,
  p_gender   text default null,
  p_scope    text default 'overall'
)
returns numeric
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  pj    jsonb;
  brk   record;
  -- (percentile, time_ms) 순서쌍 (오름차순 시간)
  pts   numeric[][] := array[]::numeric[][];
  i     int;
  labels text[]  := array['p10','p25','p50','p75','p90','p99'];
  ptile  numeric[] := array[10,25,50,75,90,99];
  t_prev numeric; p_prev numeric; t_cur numeric; p_cur numeric;
  cdf    numeric;  -- 이 시간 이하로 완주한 필드 비율(%)
begin
  if p_total_ms is null or p_division is null then
    return null;
  end if;

  select percentiles into pj
  from race_benchmarks
  where division = p_division
    and gender = coalesce(nullif(p_gender,''),'x')
    and scope = p_scope
  limit 1;

  if pj is null then
    select percentiles into pj
    from race_benchmarks
    where division = p_division and gender = 'all' and scope = p_scope
    limit 1;
  end if;

  if pj is null then
    return null;
  end if;

  -- 경계 밖 처리: 가장 빠른 브레이크포인트보다 빠르면 상위 극단, 느리면 하위 극단
  if p_total_ms <= (pj->>'p10')::numeric then
    return round(greatest(1, (p_total_ms / (pj->>'p10')::numeric) * 10)::numeric, 1);
  end if;
  if p_total_ms >= (pj->>'p99')::numeric then
    return 99;
  end if;

  -- p10..p99 사이 선형보간으로 cdf(=상위 %) 산출
  for i in 1..array_length(labels,1)-1 loop
    t_prev := (pj->>labels[i])::numeric;
    t_cur  := (pj->>labels[i+1])::numeric;
    p_prev := ptile[i];
    p_cur  := ptile[i+1];
    if p_total_ms >= t_prev and p_total_ms <= t_cur then
      if t_cur = t_prev then
        cdf := p_cur;
      else
        cdf := p_prev + (p_cur - p_prev) * (p_total_ms - t_prev) / (t_cur - t_prev);
      end if;
      return round(cdf, 1);
    end if;
  end loop;

  return null;
end;
$$;

grant execute on function public.race_percentile(bigint, text, text, text) to anon, authenticated;
