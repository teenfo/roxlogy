-- ============================================================
-- 시드 01 — 운동 코어 세트 (HYROX 8스테이션 + 러닝)
-- 공용 마스터 데이터. id는 고정 UUID (다른 시드/테스트가 참조).
-- 재실행 안전 (on conflict do update).
-- ============================================================

insert into public.exercises (id, name_ko, name_en, category, equipment, station_type) values
  ('e0000000-0000-0000-0000-000000000001', '스키에르그 1000m',        'SkiErg 1000m',            'conditioning', array['skierg'],   'station_1'),
  ('e0000000-0000-0000-0000-000000000002', '슬레드 푸시 50m',         'Sled Push 50m',           'strength',     array['sled'],     'station_2'),
  ('e0000000-0000-0000-0000-000000000003', '슬레드 풀 50m',           'Sled Pull 50m',           'strength',     array['sled'],     'station_3'),
  ('e0000000-0000-0000-0000-000000000004', '버피 브로드점프 80m',     'Burpee Broad Jumps 80m',  'conditioning', array[]::text[],   'station_4'),
  ('e0000000-0000-0000-0000-000000000005', '로잉 1000m',              'Rowing 1000m',            'conditioning', array['rower'],    'station_5'),
  ('e0000000-0000-0000-0000-000000000006', '파머스 캐리 200m',        'Farmers Carry 200m',      'strength',     array['kettlebell'],'station_6'),
  ('e0000000-0000-0000-0000-000000000007', '샌드백 런지 100m',        'Sandbag Lunges 100m',     'strength',     array['sandbag'],  'station_7'),
  ('e0000000-0000-0000-0000-000000000008', '월볼 100회',              'Wall Balls 100 reps',     'conditioning', array['wallball'], 'station_8'),
  ('e0000000-0000-0000-0000-000000000009', '러닝 1km',                'Run 1km',                 'running',      array[]::text[],   null)
on conflict (id) do update set
  name_ko      = excluded.name_ko,
  name_en      = excluded.name_en,
  category     = excluded.category,
  equipment    = excluded.equipment,
  station_type = excluded.station_type;
