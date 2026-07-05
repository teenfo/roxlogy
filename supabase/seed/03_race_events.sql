-- ============================================================
-- 시드 03 — 공식 대회 일정 (공개 발표분, 2026-07-05 기준 조사)
-- 날짜가 확정 공표된 대회만 start/end_date 기입, 월 단위 공지는
-- date_note로 표기. 재실행 안전 (name+season 기준 upsert).
-- 출처: hyrox.com 및 공개 캘린더 집계 (사실 정보만)
-- ============================================================

create unique index if not exists uq_race_events_name_season
  on public.race_events(name, season);

insert into public.race_events
  (name, city, country, region, venue, start_date, end_date, date_note, season, official_url)
values
  -- 한국
  ('HYROX Incheon', '인천', '대한민국', 'asia', '송도 컨벤시아',
   '2026-05-15', '2026-05-17', null, 'S8 2025/26', 'https://hyrox.com/find-my-race/'),
  ('HYROX Seoul', '서울', '대한민국', 'asia', 'KINTEX',
   '2026-11-14', '2026-11-15', null, 'S9 2026/27', 'https://hyrox.com/event/hyrox-seoul/'),
  -- 아시아·태평양
  ('HYROX Shanghai', '상하이', '중국', 'asia', null,
   null, null, '2026년 5월 개최됨', 'S8 2025/26', 'https://hyrox.com/find-my-race/'),
  ('HYROX Hangzhou', '항저우', '중국', 'asia', null,
   null, null, '2026년 7월 예정', 'S9 2026/27', 'https://hyrox.com/find-my-race/'),
  ('HYROX Chengdu', '청두', '중국', 'asia', null,
   null, null, '2026년 8월 예정', 'S9 2026/27', 'https://hyrox.com/find-my-race/'),
  ('HYROX Shenzhen', '선전', '중국', 'asia', null,
   null, null, '2026년 8월 예정', 'S9 2026/27', 'https://hyrox.com/find-my-race/'),
  ('HYROX Beijing', '베이징', '중국', 'asia', null,
   null, null, '2026년 9월 예정', 'S9 2026/27', 'https://hyrox.com/find-my-race/'),
  ('HYROX Guangzhou', '광저우', '중국', 'asia', null,
   null, null, '2026년 11월 예정', 'S9 2026/27', 'https://hyrox.com/find-my-race/'),
  ('HYROX Chiba', '지바', '일본', 'asia', null,
   null, null, '2026년 8월 예정', 'S9 2026/27', 'https://hyrox.com/find-my-race/'),
  ('HYROX Jakarta', '자카르타', '인도네시아', 'asia', null,
   null, null, '2026년 6월 예정', 'S9 2026/27', 'https://hyrox.com/find-my-race/'),
  -- 유럽
  ('HYROX Maastricht', '마스트리흐트', '네덜란드', 'europe', 'MECC Maastricht',
   '2026-09-17', '2026-09-20', null, 'S9 2026/27', 'https://hyrox.com/find-my-race/'),
  -- 북미
  ('HYROX Salt Lake City', '솔트레이크시티', '미국', 'north_america', null,
   '2026-09-18', '2026-09-20', null, 'S9 2026/27', 'https://hyrox.com/find-my-race/'),
  ('HYROX Washington DC', '워싱턴 DC', '미국', 'north_america', null,
   null, null, '2026년 9월 예정', 'S9 2026/27', 'https://hyrox.com/find-my-race/'),
  ('HYROX Anaheim', '애너하임', '미국', 'north_america', null,
   '2026-12-03', '2026-12-06', null, 'S9 2026/27', 'https://hyrox.com/find-my-race/'),
  ('HYROX Vancouver', '밴쿠버', '캐나다', 'north_america', null,
   null, null, '2026년 12월 예정', 'S9 2026/27', 'https://hyrox.com/find-my-race/'),
  -- 남미
  ('HYROX Buenos Aires', '부에노스아이레스', '아르헨티나', 'south_america', null,
   null, null, '2026년 6월 예정', 'S9 2026/27', 'https://hyrox.com/find-my-race/'),
  ('HYROX Rio de Janeiro', '리우데자네이루', '브라질', 'south_america', null,
   null, null, '2026년 11월 예정', 'S9 2026/27', 'https://hyrox.com/find-my-race/'),
  -- 세계선수권
  ('HYROX World Championships 2027', '홍콩', '홍콩', 'asia', 'AsiaWorld-Expo',
   null, null, '2027년 (일정 미공표)', 'S9 2026/27', 'https://hyrox.com/find-my-race/')
on conflict (name, season) do update set
  city = excluded.city, country = excluded.country, region = excluded.region,
  venue = excluded.venue, start_date = excluded.start_date,
  end_date = excluded.end_date, date_note = excluded.date_note,
  official_url = excluded.official_url;
