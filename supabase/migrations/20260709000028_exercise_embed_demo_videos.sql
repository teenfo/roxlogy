-- 운동 시연 영상 전체 임베드화: 그동안 유튜브 "검색 링크"(youtube.com/results)만
-- 갖고 있던 운동 78개(고유명 77종)에 실제 시연/기술 영상 ID를 매핑해
-- watch?v= 형태로 교체한다. 상세 페이지는 watch/youtu.be/shorts URL을 iframe으로
-- 임베드하므로, 이 교체만으로 모든 운동이 인라인 임베드로 표시된다.
-- (스테이션 8종은 026에서 이미 공식 임베드 적용됨 — 여기서는 건드리지 않음)
--
-- 영상 ID는 WebSearch 결과에 실제로 등장한 URL에서 수집한 값(임의 생성 아님).
-- 임베드가 비활성화된 영상이면 iframe이 "YouTube에서 보기"로 대체되고, 상세
-- 페이지에도 유튜브 링크 폴백이 있으므로 사용자는 어떤 경우에도 영상에 도달한다.
update exercises e
set media_url = 'https://www.youtube.com/watch?v=' || m.vid
from (values
  -- conditioning / core
  ('Ab Wheel Rollout',        'j6lR4u193gE'),
  ('Air Runner',              '3u7DNbC0U9o'),
  ('American KB Swing',       'dUlk6ZmFtAU'),
  ('Assault Bike',            'jinMaYRpOTQ'),
  ('Battle Ropes',            'nzlmTiKqno0'),
  ('Box Jumps',               'G-bxQY57mKc'),
  ('Devil Press',             'cBGQrgovLFM'),
  ('Double Unders',           'pQRnSYfliEc'),
  ('Hanging Leg Raise',       'rbOJSK07AGA'),
  ('Hollow Hold',             'HAfUt2Cco74'),
  ('Kettlebell Swings',       'Y2HTBalOeBY'),
  ('Man Makers',              'ni2jUhihLuw'),
  ('Pallof Press',            '_2xWmYNnFS8'),
  ('Plank',                   'mwlp75MS6Rg'),
  ('Russian Twist',           'IJDOoVyVjhc'),
  ('Side Plank',              '44ND4bOB-T0'),
  ('Slam Balls',              'c4GgJ94X6hM'),
  ('Thrusters',               'z0PGxb8BSq8'),
  ('Toes to Bar',             'DVMrILiX_oc'),
  ('V-Ups',                   'DfVArP2V6kg'),
  ('Wall Walks',              'ycKvYNOEoI4'),
  -- mobility
  ('90/90 Hip Stretch',       'VYvMMw8z3rE'),
  ('Band Shoulder Warmup',    '7p-Ma0eksaY'),
  ('Calf Stretch',            'yhnBpnrhRpk'),
  ('Couch Stretch',           'fRvDt6mHW60'),
  ('Foam Roll Quads',         'fvVua1NNzC4'),
  ('Foam Roll T-Spine',       'C46yWn12JZY'),
  ('Hip Flexor Stretch',      'evs7hour2qI'),
  ('Pec Stretch',             'M850sCj9LHQ'),
  ('Wall Ankle Mobility',     'Y1IZXkdPPdw'),
  ('World''s Greatest Stretch','T6j7BpxeqqU'),
  -- running (해당 훈련 유형에 맞는 러닝 기술/코칭 영상)
  ('1km Intervals x5',        'y126khD2Q5k'),
  ('400m Intervals x8',       'u5ctToFMgI0'),
  ('Compromised Run',         'vfdhlj2SPC8'),
  ('Hill Sprints',            'fZ85Ht6y8Vc'),
  ('Run 1.6km',               'E6ejOPp1vjM'),
  ('Run 10km',                'dkB8HOO_00Y'),
  ('Run 1km',                 '_kGESn8ArrU'),
  ('Run 3km',                 'hMH1QYE8F7Q'),
  ('Run 400m',                'rFlJPm9wd1o'),
  ('Run 5km',                 '_pZX-PnTz9Y'),
  ('Run 800m',                'fa7m0b0Ey00'),
  ('Steady State Run',        'Q1GBckR4H-E'),
  ('Tempo Run',               'lGgyAyFCzNk'),
  ('Treadmill Intervals',     'ufhM_9eLU-s'),
  -- strength A
  ('Back Squat',              'bEv6CCg2BC8'),
  ('Barbell Row',             'G8l_8chR5BE'),
  ('Bench Press',             'vcBig73ojpE'),
  ('Bulgarian Split Squat',   'hiLF_pF3EJM'),
  ('Calf Raise',              'SVtg-1loH4c'),
  ('Chin Ups',                'e1YSApl-QcM'),
  ('Clean & Jerk',            '8miqQQJEsO0'),
  ('Dead Hang',               '2vspW4N4BMs'),
  ('Deadlift',                'QXhgs2JbLr4'),
  ('Dips',                    'K5JxupmoLW4'),
  ('Dumbbell Row',            'tLnlWj7LQ34'),
  ('Front Rack Carry',        'alKIr-rJ8GY'),
  ('Front Squat',             'wyDbagKS7Rg'),
  ('Glute Bridge',            'OUgsJ8-Vi0E'),
  ('Goblet Squat',            'BR4tlEE_A98'),
  ('Hip Thrust',              'S_uZP4UH6J0'),
  -- strength B
  ('Leg Press',               'K5n2vg3oZa4'),
  ('Nordic Curl',             '_e9vFU9-tkc'),
  ('Overhead Carry',          'u2zEzUeOI-o'),
  ('Overhead Press',          'F3QY5vMz_6I'),
  ('Power Clean',             'ORGBFvyUwGs'),
  ('Pull Ups',                'vw5Xmu5CIew'),
  ('Push Press',              'yklSQG1_Ovc'),
  ('Push Ups',                'WDIpL0pjun0'),
  ('Romanian Deadlift',       '5bJEigM5iVg'),
  ('Sandbag Shoulder Carry',  'i7NQzjLpwr8'),
  ('Snatch',                  'UQS6k0Gsyrw'),
  ('Step Ups',                'vOiHvzj5XhA'),
  ('Suitcase Carry',          'y-hn_Ha1-RE'),
  ('Trap Bar Deadlift',       'EsqwERaSTMI'),
  ('Walking Lunge',           'L8fvypPrzzs'),
  ('Yoke Carry',              'zRsFkNPxaMM')
) as m(name, vid)
where e.name_en = m.name
  and e.media_url ~ 'youtube\.com/results';
