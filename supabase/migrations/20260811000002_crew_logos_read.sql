-- ============================================================
-- Roxlogy — 크루 로고 버킷 읽기 정책 보강
--
-- storage upload(upsert)는 INSERT 후 행을 읽어 반환(RETURNING)하고,
-- 업서트 존재 확인도 SELECT 를 탄다. SELECT 정책이 없으면 스태프의
-- 정당한 업로드도 "new row violates row-level security policy" 로
-- 실패한다. 공개 버킷이므로 읽기는 전체 허용.
-- ============================================================

drop policy if exists "crew_logos_read" on storage.objects;
create policy "crew_logos_read" on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'crew-logos');
