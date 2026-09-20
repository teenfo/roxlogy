-- 사이드바 푸터에 고정할 크루 (디자인 리뉴얼 PORT_PLAN §7-5, 2026-09-20 확정).
--
-- 시안의 사이드바 푸터는 "내 크루" 한 곳을 보여준다. 여러 크루에 든 사람은
-- 어느 크루를 고정할지 설정에서 고른다. null 이면 가장 오래 가입한 활성 크루가
-- 자동으로 잡힌다(lib/shell.ts). 탈퇴·삭제되면 null 로 돌아간다(on delete set null).
--
-- RLS: profiles_update 정책(본인 또는 관리자)이 그대로 덮는다 — 새 정책 없음.
-- 되돌리기: alter table public.profiles drop column sidebar_crew_id;

alter table public.profiles
  add column if not exists sidebar_crew_id uuid
    references public.crews(id) on delete set null;

comment on column public.profiles.sidebar_crew_id is
  '사이드바 푸터에 고정할 크루. null 이면 가장 오래 가입한 활성 크루';
