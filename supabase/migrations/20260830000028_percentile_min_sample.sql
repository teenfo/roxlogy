-- Roxlogy — 표본 부족 분포에서는 백분위를 계산하지 않는다
--
-- race_benchmarks 는 p10~p99 여섯 앵커의 보간으로 백분위를 낸다. 표본이 얇으면
-- 양 끝 앵커가 사실상 한두 명의 기록이라 "상위 99%" 같은 숫자가 근거 없이 나온다.
-- 특히 pro·pro_doubles 행은 실측 집계가 아니라 근사 베이스라인이다
-- (source='public-aggregate-baseline-v1 (approx)', sample_size is null).
-- 실제로 프로 더블 1:39:55 가 '상위 99%' 로 표시되고 있었다.
--
-- 기준 미만이면 null 을 반환해 UI 가 배지를 숨기게 한다.
-- 웹의 lib/percentile.ts(MIN_BENCHMARK_SAMPLE)와 같은 값을 쓴다.

create or replace function public.race_percentile(
  p_total_ms bigint, p_division text, p_gender text default null,
  p_scope text default 'overall')
returns numeric language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  min_n constant int := 100; -- web/lib/percentile.ts MIN_BENCHMARK_SAMPLE 와 동일
  pj    jsonb;
  i     int;
  labels text[]  := array['p10','p25','p50','p75','p90','p99'];
  ptile  numeric[] := array[10,25,50,75,90,99];
  t_prev numeric; p_prev numeric; t_cur numeric; p_cur numeric;
  cdf    numeric;
begin
  if p_total_ms is null or p_division is null then
    return null;
  end if;

  -- 성별 분포 (표본 충분할 때만)
  select percentiles into pj
  from race_benchmarks
  where division = p_division
    and gender = coalesce(nullif(p_gender,''),'x')
    and scope = p_scope
    and coalesce(sample_size, 0) >= min_n
  limit 1;

  -- 없거나 표본 부족이면 'all' 분포로 (역시 표본 충분할 때만)
  if pj is null then
    select percentiles into pj
    from race_benchmarks
    where division = p_division and gender = 'all' and scope = p_scope
      and coalesce(sample_size, 0) >= min_n
    limit 1;
  end if;

  if pj is null then
    return null;
  end if;

  if p_total_ms <= (pj->>'p10')::numeric then
    return round(greatest(1, (p_total_ms / (pj->>'p10')::numeric) * 10)::numeric, 1);
  end if;
  if p_total_ms >= (pj->>'p99')::numeric then
    return 99;
  end if;

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
$function$;

comment on function public.race_percentile(bigint, text, text, text) is
  '완주 시간의 필드 내 백분위(작을수록 빠름). 표본 100건 미만이거나 근사 '
  '베이스라인(sample_size is null)인 분포는 null 을 반환한다 — 근거 없는 '
  '숫자를 보여주느니 배지를 숨긴다.';

-- 가드: 근사 베이스라인으로는 백분위가 나오면 안 된다
do $$
declare v numeric;
begin
  select race_percentile(5995000, 'pro_doubles', 'male') into v;
  if v is not null then
    raise exception '근사 베이스라인(pro_doubles)에서 백분위가 나왔다: %', v;
  end if;
  select race_percentile(4399000, 'doubles', 'male') into v;
  if v is null then
    raise exception '실측 분포(doubles)에서 백분위가 사라졌다';
  end if;
end $$;
