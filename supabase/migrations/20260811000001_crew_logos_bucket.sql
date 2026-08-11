-- ============================================================
-- Roxlogy — 크루 로고 버킷
--
-- 크루 로고 이미지를 공개 URL로 서빙하기 위한 스토리지 버킷.
-- public=true → 읽기는 인증 없이 공개 URL. 쓰기는 해당 크루의
-- 스태프(리더·부리더)만 — 오브젝트 경로 규약 <crew_id>/... 의
-- 첫 폴더를 크루 id 로 보고 is_crew_staff() 로 판정한다.
-- 공개 URL: /storage/v1/object/public/crew-logos/<crew_id>/logo
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'crew-logos', 'crew-logos', true,
  2097152, -- 2MB
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "crew_logos_staff_insert" on storage.objects;
create policy "crew_logos_staff_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'crew-logos'
    and public.is_crew_staff(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "crew_logos_staff_update" on storage.objects;
create policy "crew_logos_staff_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'crew-logos'
    and public.is_crew_staff(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'crew-logos'
    and public.is_crew_staff(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "crew_logos_staff_delete" on storage.objects;
create policy "crew_logos_staff_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'crew-logos'
    and public.is_crew_staff(((storage.foldername(name))[1])::uuid)
  );
