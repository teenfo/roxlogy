-- ============================================================
-- Roxlogy — 시스템 감사 수리 (2) 크루 탈퇴 가드
--
-- crew_members_leave_self 정책은 본인 행 삭제를 허용하지만,
-- 리더(owner)가 위임 없이 나가면 크루가 운영자 없이 남는다.
-- 웹 UI 는 리더에게 탈퇴 버튼을 숨기지만, 서버에서도 막는다.
-- (관리자·크루 삭제 cascade 는 예외로 통과)
-- ============================================================

create or replace function public.crew_leave_guard()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if old.role = 'owner' and not is_admin()
     and exists (select 1 from crews c where c.id = old.crew_id) then
    raise exception '리더는 리더 위임 후에만 크루를 나갈 수 있습니다'
      using errcode = 'P0001';
  end if;
  return old;
end; $$;

drop trigger if exists crew_members_leave_guard on public.crew_members;
create trigger crew_members_leave_guard
  before delete on public.crew_members
  for each row execute function public.crew_leave_guard();
