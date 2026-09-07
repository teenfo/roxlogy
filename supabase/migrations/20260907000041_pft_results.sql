-- ============================================================
-- Roxlogy — PFT (Physical Fitness Test) 측정 기록
--
-- PFT 는 대회가 아니라 제휴 체육관에서 치르는 표준 체력 측정이다.
-- 6종목을 쉬는 시간 없이 연속으로 하고 총 시간 하나로 채점한다:
--   1000m 런 → 버피 브로드 점프 50 → 스테이셔너리 런지 100
--   → 1000m 로우 → 핸드 릴리즈 푸시업 30 → 월볼 100 (남 6kg / 여 4kg)
--
-- 디비전(open/pro/doubles/...)과는 완전히 별개라 race_results 에 끼우지
-- 않고 전용 테이블로 둔다. 백분위·리더보드 풀도 따로다.
--
-- 배지 컷오프 (사용자 확인 완료, 2026-09-07):
--   45세 미만 : 골드 22분 미만 / 실버 26분 미만 / 그 외 브론즈
--   45세 이상 : 골드 24분 미만 / 실버 28분 미만 / 그 외 브론즈
--   동작을 수정하면(거리·타깃 변경, 파트너 분담 등) 무조건 브론즈 + scaled
-- 성별로는 컷오프가 갈리지 않는다 — 리더보드 분류에만 쓴다.
-- ============================================================

create table if not exists public.pft_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tested_on date not null default app_today(),
  -- 총 시간이 곧 점수. 5분~3시간 밖은 오타로 본다.
  total_ms integer not null check (total_ms between 300000 and 10800000),
  -- 구간 스플릿 (선택) — 순서 고정이라 컬럼으로 둔다
  run_ms integer check (run_ms is null or run_ms > 0),
  burpee_ms integer check (burpee_ms is null or burpee_ms > 0),
  lunge_ms integer check (lunge_ms is null or lunge_ms > 0),
  row_ms integer check (row_ms is null or row_ms > 0),
  pushup_ms integer check (pushup_ms is null or pushup_ms > 0),
  wallball_ms integer check (wallball_ms is null or wallball_ms > 0),
  -- 배지 판정 근거는 측정 시점 값으로 고정한다. 나중에 생일이 지나거나
  -- 프로필을 고쳐도 이미 받은 배지가 바뀌면 안 된다.
  age integer check (age is null or age between 10 and 100),
  gender text check (gender is null or gender in ('male', 'female', 'other')),
  scaled boolean not null default false,
  -- 나이를 모르면 더 엄격한 45세 미만 기준을 쓴다 (배지를 과대 부여하지 않음)
  badge text generated always as (
    case
      when scaled then 'bronze'
      when age is not null and age >= 45 then
        case when total_ms < 1440000 then 'gold'
             when total_ms < 1680000 then 'silver'
             else 'bronze' end
      else
        case when total_ms < 1320000 then 'gold'
             when total_ms < 1560000 then 'silver'
             else 'bronze' end
    end
  ) stored,
  location text check (location is null or char_length(location) <= 80),
  note text check (note is null or char_length(note) <= 500),
  -- 리더보드 공개 여부 (프로필의 leaderboard_opt_in 과 함께 AND 로 적용)
  shared boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists pft_results_user_idx
  on public.pft_results(user_id, tested_on desc) where deleted_at is null;
create index if not exists pft_results_board_idx
  on public.pft_results(total_ms) where deleted_at is null and shared;

create trigger pft_results_set_updated_at before update on public.pft_results
  for each row execute function public.set_updated_at();

alter table public.pft_results enable row level security;

-- 명령별로 정책 하나씩 (CLAUDE.md 규칙)
drop policy if exists pft_results_select on public.pft_results;
create policy pft_results_select on public.pft_results
  for select using (
    user_id = (select auth.uid())
    or (deleted_at is null and shared)
    or (select is_admin())
  );
drop policy if exists pft_results_insert on public.pft_results;
create policy pft_results_insert on public.pft_results
  for insert with check (user_id = (select auth.uid()));
drop policy if exists pft_results_update on public.pft_results;
create policy pft_results_update on public.pft_results
  for update using (user_id = (select auth.uid()) or (select is_admin()))
  with check (user_id = (select auth.uid()) or (select is_admin()));
drop policy if exists pft_results_delete on public.pft_results;
create policy pft_results_delete on public.pft_results
  for delete using (user_id = (select auth.uid()) or (select is_admin()));

-- 리더보드 — 사람당 최고 기록 1건. 공개(shared) + 프로필 옵트인 둘 다 필요.
create or replace function public.pft_leaderboard(
  p_gender text default null,
  p_age_group text default null,   -- 'u45' | 'o45' | null(전체)
  p_limit integer default 50
)
returns table(
  rank bigint, user_id uuid, display_name text,
  total_ms integer, badge text, tested_on date,
  gender text, age integer, scaled boolean
)
language sql stable security definer set search_path to 'public' as $$
  with best as (
    select distinct on (r.user_id)
           r.user_id, r.total_ms, r.badge, r.tested_on, r.gender, r.age, r.scaled
    from pft_results r
    join profiles p on p.id = r.user_id
    where r.deleted_at is null and r.shared and p.leaderboard_opt_in
      and (p_gender is null or r.gender = p_gender)
      and (p_age_group is null
           or (p_age_group = 'u45' and coalesce(r.age, 0) < 45)
           or (p_age_group = 'o45' and r.age >= 45))
    order by r.user_id, r.total_ms, r.tested_on desc
  )
  select row_number() over (order by b.total_ms, b.tested_on),
         b.user_id, coalesce(p.display_name, 'Athlete'),
         b.total_ms, b.badge, b.tested_on, b.gender, b.age, b.scaled
  from best b join profiles p on p.id = b.user_id
  order by b.total_ms, b.tested_on
  limit least(p_limit, 200);
$$;
grant execute on function public.pft_leaderboard(text, text, integer) to anon, authenticated;

-- 가드 ------------------------------------------------------------------------
do $$
declare
  v_uid uuid;
  v_bad text;
  rec record;
  cases constant text[][] := array[
    -- [total_ms, age, scaled, 기대 배지]
    ['1319000', '30', 'false', 'gold'],    -- 21:59
    ['1320000', '30', 'false', 'silver'],  -- 22:00 (미만이므로 실버)
    ['1559000', '30', 'false', 'silver'],  -- 25:59
    ['1560000', '30', 'false', 'bronze'],  -- 26:00
    ['1439000', '50', 'false', 'gold'],    -- 23:59
    ['1440000', '50', 'false', 'silver'],  -- 24:00
    ['1679000', '50', 'false', 'silver'],  -- 27:59
    ['1680000', '50', 'false', 'bronze'],  -- 28:00
    ['1000000', '30', 'true',  'bronze'],  -- scaled 는 시간과 무관
    ['1319000', null,  'false', 'gold']    -- 나이 모르면 45세 미만 기준
  ];
  i int;
begin
  select id into v_uid from public.profiles limit 1;
  if v_uid is null then return; end if;  -- 빈 DB면 건너뜀

  for i in 1 .. array_length(cases, 1) loop
    insert into public.pft_results(user_id, total_ms, age, scaled, note)
    values (v_uid, cases[i][1]::int, cases[i][2]::int, cases[i][3]::boolean, '__guard__');
  end loop;

  for rec in
    select r.total_ms, r.age, r.scaled, r.badge from public.pft_results r
     where r.note = '__guard__' order by r.total_ms
  loop
    for i in 1 .. array_length(cases, 1) loop
      if rec.total_ms = cases[i][1]::int
         and rec.age is not distinct from cases[i][2]::int
         and rec.scaled = cases[i][3]::boolean
         and rec.badge <> cases[i][4] then
        v_bad := format('total=%s age=%s scaled=%s → %s (기대 %s)',
                        rec.total_ms, rec.age, rec.scaled, rec.badge, cases[i][4]);
      end if;
    end loop;
  end loop;

  delete from public.pft_results where note = '__guard__';
  if v_bad is not null then raise exception '가드: 배지 판정이 틀렸습니다 — %', v_bad; end if;

  if has_function_privilege('anon', 'public.pft_leaderboard(text, text, integer)', 'execute') is not true then
    raise exception '가드: pft_leaderboard 에 execute 가 빠졌습니다';
  end if;
end $$;
