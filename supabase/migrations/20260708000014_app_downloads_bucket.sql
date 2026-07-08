-- ============================================================
-- Roxlogy — 014 공개 앱 배포 버킷 (사이드로드 APK)
--
-- 네이티브 워치/폰 APK를 공개 URL로 직접 다운로드하기 위한 스토리지 버킷.
-- public=true → 인증 없이 공개 URL 접근. 업로드는 CI가 service role로만 수행
-- (android-release 워크플로). service role 키는 클라이언트에 절대 노출 금지.
-- 공개 URL: /storage/v1/object/public/app-downloads/<file>
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'app-downloads', 'app-downloads', true,
  104857600, -- 100MB
  array['application/vnd.android.package-archive','application/octet-stream']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
