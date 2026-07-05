-- ============================================================
-- HYROX Training App — 002 RLS 정책
-- 원칙:
--  • 사용자 데이터(profiles/sessions/segments/erg/metrics/race)는 본인만 접근
--  • segments/erg_samples/segment_metrics는 직접 user_id가 없으므로
--    session을 경유(조인)해 소유권을 판정한다  ← 기획서에서 미해결로 남긴 부분
--  • exercises / 공용 programs는 인증 사용자 읽기 허용
--  • service role(hosub 워커)은 RLS를 우회하므로 분석 write는 정책 불필요
--    (단, service role 키는 서버/워커 내부에서만 사용 — 클라이언트 노출 금지)
-- ============================================================

-- ------------------------------------------------------------
-- RLS 활성화
-- ------------------------------------------------------------
alter table public.profiles               enable row level security;
alter table public.exercises              enable row level security;
alter table public.programs               enable row level security;
alter table public.program_days           enable row level security;
alter table public.workout_templates      enable row level security;
alter table public.workout_template_items enable row level security;
alter table public.sessions               enable row level security;
alter table public.session_segments       enable row level security;
alter table public.erg_samples            enable row level security;
alter table public.segment_metrics        enable row level security;
alter table public.race_results           enable row level security;

-- ------------------------------------------------------------
-- profiles: 본인 프로필만 read/update (insert는 트리거가 처리)
-- ------------------------------------------------------------
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ------------------------------------------------------------
-- exercises: 인증 사용자 전체 읽기 (공용 마스터 DB)
-- ------------------------------------------------------------
create policy "exercises_select_all" on public.exercises
  for select using (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- programs: 공용(is_public) 또는 본인 소유 읽기 / 본인 소유만 쓰기
-- ------------------------------------------------------------
create policy "programs_select_public_or_own" on public.programs
  for select using (is_public or owner_id = auth.uid());
create policy "programs_insert_own" on public.programs
  for insert with check (owner_id = auth.uid());
create policy "programs_update_own" on public.programs
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "programs_delete_own" on public.programs
  for delete using (owner_id = auth.uid());

-- program_days: 상위 program의 접근 권한을 상속 (조인 판정)
create policy "program_days_select" on public.program_days
  for select using (
    exists (
      select 1 from public.programs p
      where p.id = program_days.program_id
        and (p.is_public or p.owner_id = auth.uid())
    )
  );
create policy "program_days_write" on public.program_days
  for all using (
    exists (
      select 1 from public.programs p
      where p.id = program_days.program_id and p.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.programs p
      where p.id = program_days.program_id and p.owner_id = auth.uid()
    )
  );

-- workout_templates: program_day → program 경유 판정
create policy "workout_templates_select" on public.workout_templates
  for select using (
    exists (
      select 1 from public.program_days d
      join public.programs p on p.id = d.program_id
      where d.id = workout_templates.program_day_id
        and (p.is_public or p.owner_id = auth.uid())
    )
  );
create policy "workout_templates_write" on public.workout_templates
  for all using (
    exists (
      select 1 from public.program_days d
      join public.programs p on p.id = d.program_id
      where d.id = workout_templates.program_day_id and p.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.program_days d
      join public.programs p on p.id = d.program_id
      where d.id = workout_templates.program_day_id and p.owner_id = auth.uid()
    )
  );

-- workout_template_items: template → day → program 경유 판정
create policy "workout_template_items_select" on public.workout_template_items
  for select using (
    exists (
      select 1 from public.workout_templates t
      join public.program_days d on d.id = t.program_day_id
      join public.programs p on p.id = d.program_id
      where t.id = workout_template_items.template_id
        and (p.is_public or p.owner_id = auth.uid())
    )
  );
create policy "workout_template_items_write" on public.workout_template_items
  for all using (
    exists (
      select 1 from public.workout_templates t
      join public.program_days d on d.id = t.program_day_id
      join public.programs p on p.id = d.program_id
      where t.id = workout_template_items.template_id and p.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.workout_templates t
      join public.program_days d on d.id = t.program_day_id
      join public.programs p on p.id = d.program_id
      where t.id = workout_template_items.template_id and p.owner_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- sessions: 본인 세션만 (직접 user_id 보유)
-- ------------------------------------------------------------
create policy "sessions_select_own" on public.sessions
  for select using (user_id = auth.uid());
create policy "sessions_insert_own" on public.sessions
  for insert with check (user_id = auth.uid());
create policy "sessions_update_own" on public.sessions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "sessions_delete_own" on public.sessions
  for delete using (user_id = auth.uid());

-- ------------------------------------------------------------
-- session_segments: session 경유 소유권 판정 (핵심)
-- ------------------------------------------------------------
create policy "segments_select_own" on public.session_segments
  for select using (
    exists (
      select 1 from public.sessions s
      where s.id = session_segments.session_id and s.user_id = auth.uid()
    )
  );
create policy "segments_write_own" on public.session_segments
  for all using (
    exists (
      select 1 from public.sessions s
      where s.id = session_segments.session_id and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.sessions s
      where s.id = session_segments.session_id and s.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- erg_samples: segment → session 경유 소유권 판정 (2단계 조인)
-- ------------------------------------------------------------
create policy "erg_samples_select_own" on public.erg_samples
  for select using (
    exists (
      select 1 from public.session_segments seg
      join public.sessions s on s.id = seg.session_id
      where seg.id = erg_samples.segment_id and s.user_id = auth.uid()
    )
  );
create policy "erg_samples_write_own" on public.erg_samples
  for all using (
    exists (
      select 1 from public.session_segments seg
      join public.sessions s on s.id = seg.session_id
      where seg.id = erg_samples.segment_id and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.session_segments seg
      join public.sessions s on s.id = seg.session_id
      where seg.id = erg_samples.segment_id and s.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- segment_metrics: segment → session 경유. 사용자는 읽기만.
-- (write는 hosub 워커 = service role이 RLS 우회하여 수행)
-- ------------------------------------------------------------
create policy "segment_metrics_select_own" on public.segment_metrics
  for select using (
    exists (
      select 1 from public.session_segments seg
      join public.sessions s on s.id = seg.session_id
      where seg.id = segment_metrics.segment_id and s.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------
-- race_results: 본인만
-- ------------------------------------------------------------
create policy "race_results_select_own" on public.race_results
  for select using (user_id = auth.uid());
create policy "race_results_write_own" on public.race_results
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
