-- ============================================================
-- Roxlogy — S9(2026/27) 아시아 대회 일정 보강
--
-- race_events 시드가 낡아 2027년 1월 홍콩 대회 등이 검색되지 않았다.
-- 공개된 사실 정보(대회명·도시·날짜·장소)만 수동 입력 (S12 원칙).
-- 출처: hyrox.com 이벤트 페이지·공식 발표 (2026-08 조사).
-- ============================================================

-- 월드챔피언십 홍콩 — 날짜 확정 반영
update public.race_events
set start_date = '2027-06-10', end_date = '2027-06-13',
    venue = coalesce(venue, 'AsiaWorld-Expo'), date_note = null
where name = 'HYROX World Championships 2027' and start_date is null;

insert into public.race_events (name, city, country, region, venue, start_date, end_date, season, official_url)
select v.name, v.city, v.country, 'asia', v.venue, v.start_date::date, v.end_date::date, 'S9 2026/27', v.url
from (values
  ('AIA HYROX Hong Kong',  '홍콩',     '홍콩',     'AsiaWorld-Expo',       '2027-01-07', '2027-01-10', 'https://hyrox.com/find-my-race/'),
  ('BYD HYROX Osaka',      '오사카',   '일본',     null,                   '2027-01-21', '2027-01-24', 'https://hyrox.com/event/byd-hyrox-osaka/'),
  -- 방콕은 시즌 내 2회(2026-08·2027-02)지만 (name, season) 유니크 제약으로 미래 회차만 수록
  ('BYD HYROX Bangkok',    '방콕',     '태국',     null,                   '2027-02-11', '2027-02-14', 'https://hyrox.com/find-my-race/'),
  ('HYROX Taipei',         '타이베이', '대만',     null,                   '2027-03-13', '2027-03-14', 'https://hyroxtaiwan.com/find-your-race/'),
  ('AIA HYROX Singapore',  '싱가포르', '싱가포르', 'National Stadium',     '2026-11-27', '2026-11-29', 'https://hyrox.com/event/aia-hyrox-singapore/'),
  ('HYROX Mumbai',         '뭄바이',   '인도',     null,                   '2026-09-18', '2026-09-20', 'https://hyrox.com/event/hyrox-mumbai/')
) as v(name, city, country, venue, start_date, end_date, url)
where not exists (
  select 1 from public.race_events e
  where e.name = v.name and e.season = 'S9 2026/27'
);
