-- ============================================================
-- Roxlogy — 알림 삭제
--
-- 알림함에 읽음 표시만 있고 지울 방법이 없어서 7월부터 쌓인 게 그대로 남는다
-- (테스트 알림 4건 포함). 내 알림은 내가 지울 수 있어야 한다.
-- ============================================================

create policy notif_delete_own on public.notifications
  for delete using (user_id = (select auth.uid()));

-- 목록은 항상 "내 것을 최신순"으로만 읽는다
create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'notifications' and p.polname = 'notif_delete_own'
  ) then
    raise exception '가드: 알림 삭제 정책이 만들어지지 않았습니다';
  end if;
end $$;
