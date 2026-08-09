-- INBRXX(인브릭스) — 스포짐 산하 하이록스 트레이닝 클럽. 첫 크루 시드.
-- 정보 출처: https://www.spogym.co.kr/_vb/page/center/inbrxx.html
-- 소유자는 배포 환경의 관리자 계정으로 별도 지정한다(여기서는 최초 admin 프로필).

insert into public.crews (slug, name, tagline, description, location, home_gym, links, is_public, join_policy, created_by)
select
  'inbrxx',
  'INBRXX',
  'HYROX TRAINING CLUB X',
  '인브릭스는 국내 최초로 하이록스 W.O.D 수업을 운영하는 HYROX TRAINING CLUB X입니다. HYROX 365 PROGRAM을 통해 러닝과 기능성 근력 운동을 체계적으로 결합하여 체력, 근력, 지구력과 운동 수행 능력을 균형 있게 향상할 수 있는 전문 트레이닝을 제공합니다. 개인의 운동 수준과 목표에 맞춰 단계적으로 훈련하며, 하이록스 대회 준비부터 일상적인 체력 관리까지 함께할 수 있습니다.',
  '경기 성남시 분당구 판교',
  '스포짐 INBRXX',
  jsonb_build_object(
    'official', 'https://www.spogym.co.kr/_vb/page/center/inbrxx.html',
    'phone', '070-7705-1872',
    'kakao', 'INBRXX',
    'hours_weekday', '06:30 - 22:30',
    'hours_weekend', '09:00 - 18:00',
    'parent_brand', '스포짐 (SPOGYM)'
  ),
  true, 'open',
  (select id from public.profiles where is_admin order by created_at limit 1)
on conflict (slug) do nothing;

insert into public.crew_members (crew_id, user_id, role, status)
select c.id, p.id, 'owner', 'active'
from public.crews c
cross join lateral (
  select id from public.profiles where is_admin order by created_at limit 1
) p
where c.slug = 'inbrxx'
on conflict (crew_id, user_id) do update set role = 'owner', status = 'active';
