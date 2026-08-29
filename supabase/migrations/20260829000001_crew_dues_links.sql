-- ============================================================
-- Roxlogy — 크루 회비 납부 링크 (카카오페이 송금 링크 등)
--
-- 등급별 회비가 다를 수 있어 링크를 여러 개 등록하고,
-- 각 링크에 명칭과 표시 대상(전체/정회원/일반회원)을 지정한다.
-- 조회는 본인 등급에 해당하는 링크만 — 운영진·관리자는 전체.
-- ============================================================

create table if not exists public.crew_dues_links (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  -- <a href> 로 렌더링되므로 http(s) 만 허용 (javascript: 등 차단)
  url text not null check (url ~* '^https?://' and char_length(url) <= 500),
  audience text not null default 'all'
    check (audience in ('all', 'member', 'associate')),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists crew_dues_links_crew_idx
  on public.crew_dues_links(crew_id);

alter table public.crew_dues_links enable row level security;

-- 조회: 운영진·관리자는 전체, 크루원은 본인 등급 대상 링크만
create policy crew_dues_links_select on public.crew_dues_links
  for select using (
    is_admin() or is_crew_staff(crew_id)
    or (
      is_crew_member(crew_id)
      and (
        audience = 'all'
        or (audience = 'member' and is_crew_full_member(crew_id))
        or (audience = 'associate' and not is_crew_full_member(crew_id))
      )
    )
  );

-- 등록·수정·삭제: 운영진(리더·부리더)만
create policy crew_dues_links_insert on public.crew_dues_links
  for insert with check (is_crew_staff(crew_id) or is_admin());
create policy crew_dues_links_update on public.crew_dues_links
  for update using (is_crew_staff(crew_id) or is_admin());
create policy crew_dues_links_delete on public.crew_dues_links
  for delete using (is_crew_staff(crew_id) or is_admin());
