-- 운동 DB 전수 보강: 타겟 부위(muscles) + 도움 스테이션(helps_stations) + 수행 방법(description_ko)
-- helps_stations: 이 운동이 어떤 HYROX 스테이션에 전이되는지. 값 = 스테이션 key(8종) + 'run'.

alter table exercises add column if not exists helps_stations text[];

-- ── 스테이션 종목(거리·강도 변형 포함) ──────────────────────────────
update exercises set muscles=array['lats','triceps','shoulders','core'], helps_stations=array['ski'],
  description_ko='체중을 실어 손잡이를 엉덩이까지 강하게 당기고 코어로 상체를 접었다 편다. 다리·코어·팔을 리듬 있게 연결한다.'
  where name_en ilike 'SkiErg%';
update exercises set muscles=array['back','quads','biceps','core'], helps_stations=array['row'],
  description_ko='다리로 먼저 밀고 상체를 젖힌 뒤 팔로 당긴다(레그→힙→암). 복귀는 역순으로 팔→힙→다리.'
  where name_en ilike 'Rowing%';
update exercises set muscles=array['quads','glutes','calves','core'], helps_stations=array['sledpush'],
  description_ko='낮은 자세로 팔을 뻗어 지면을 강하게 밀며 짧고 빠른 보폭으로 전진한다.'
  where name_en ilike 'Sled Push%';
update exercises set muscles=array['back','biceps','hamstrings','core'], helps_stations=array['sledpull'],
  description_ko='뒤로 체중을 실어 로프를 손 교대로 강하게 당기고 발로 지면을 눌러 버틴다.'
  where name_en ilike 'Sled Pull%';
update exercises set muscles=array['full_body','quads','chest','core'], helps_stations=array['burpee'],
  description_ko='가슴을 바닥에 대고 일어나 최대한 멀리 점프한다. 착지 후 곧바로 다음 버피로 연결한다.'
  where name_en ilike 'Burpee Broad Jump%';
update exercises set muscles=array['grip','forearms','traps','core'], helps_stations=array['farmers'],
  description_ko='무게를 몸 옆에 들고 어깨를 세운 채 코어를 조여 빠르게 걷는다. 그립 유지가 관건.'
  where name_en ilike 'Farmers Carry%';
update exercises set muscles=array['quads','glutes','hamstrings','core'], helps_stations=array['lunges'],
  description_ko='샌드백을 어깨에 메고 뒷무릎이 바닥에 닿을 때까지 런지하며 상체를 세운 채 전진한다.'
  where name_en ilike 'Sandbag Lunges%';
update exercises set muscles=array['quads','glutes','shoulders','core'], helps_stations=array['wallballs'],
  description_ko='스쿼트에서 일어서는 힘으로 볼을 타겟(남 3m/여 2.7m)에 던지고 내려오는 볼을 받아 바로 스쿼트한다.'
  where name_en ilike 'Wall Balls%';

-- ── 러닝(공통) + 세부 오버라이드 ────────────────────────────────────
update exercises set muscles=array['quads','hamstrings','calves','glutes'], helps_stations=array['run'],
  description_ko='일정한 케이던스와 호흡으로 목표 페이스를 유지하며 달린다.'
  where category='running';
update exercises set description_ko='오르막을 전력으로 질주하고 걸어 내려와 회복한다. 파워와 러닝 이코노미를 키운다.' where name_en='Hill Sprints';
update exercises set description_ko='근력 운동 직후 달려 레이스에서 지친 다리 상태를 재현한다.', helps_stations=array['run','wallballs'] where name_en='Compromised Run';
update exercises set description_ko='역치 부근(편안히 힘든) 페이스로 끊지 않고 지속해 달린다.' where name_en='Tempo Run';
update exercises set description_ko='대화 가능한 편안한 페이스로 오래 달려 유산소 기반을 쌓는다.' where name_en='Steady State Run';
update exercises set description_ko='빠른 구간과 회복 조깅을 반복해 스피드와 젖산 내성을 키운다.' where name_en in ('1km Intervals x5','400m Intervals x8','Treadmill Intervals');
update exercises set description_ko='트레드밀에서 경사·속도를 조절해 실내에서 인터벌을 수행한다.' where name_en='Treadmill Intervals';
update exercises set muscles=array['quads','hamstrings','calves','glutes'], helps_stations=array['run'],
  description_ko='러너처럼 팔을 흔들며 무릎을 들어 제자리·전진 달리기로 심박을 끌어올린다.' where name_en='Air Runner';

-- ── 컨디셔닝 ────────────────────────────────────────────────────────
update exercises set muscles=array['core','lats'], helps_stations=array['sledpull','farmers'],
  description_ko='무릎을 대고 휠을 앞으로 굴려 몸을 최대한 펴고, 코어로 되감아 온다. 허리가 꺾이지 않게 한다.' where name_en='Ab Wheel Rollout';
update exercises set muscles=array['glutes','hamstrings','back','shoulders'], helps_stations=array['sledpull','wallballs'],
  description_ko='힙 힌지로 케틀벨을 다리 사이로 보냈다가 엉덩이 힘으로 머리 위까지 스윙한다.' where name_en='American KB Swing';
update exercises set muscles=array['glutes','hamstrings','back','shoulders'], helps_stations=array['sledpull','wallballs'],
  description_ko='힙 힌지로 케틀벨을 다리 사이로 보냈다가 엉덩이 힘으로 어깨 높이까지 스윙한다.' where name_en='Kettlebell Swings';
update exercises set muscles=array['quads','hamstrings','shoulders','core'], helps_stations=array['run','burpee'],
  description_ko='팔과 다리를 동시에 강하게 밀고 당기며 일정 출력으로 페달링한다.' where name_en='Assault Bike';
update exercises set muscles=array['shoulders','forearms','core'], helps_stations=array['ski'],
  description_ko='무릎을 살짝 굽힌 자세로 로프를 빠르게 교대로 쳐 파도를 만든다.' where name_en='Battle Ropes';
update exercises set muscles=array['quads','glutes','calves'], helps_stations=array['burpee','lunges'],
  description_ko='엉덩이를 뒤로 뺐다가 폭발적으로 박스 위로 점프하고, 완전히 선 뒤 내려온다.' where name_en='Box Jumps';
update exercises set muscles=array['full_body','shoulders','chest','core'], helps_stations=array['burpee','wallballs'],
  description_ko='덤벨을 쥐고 버피 후 양손을 머리 위로 스내치한다. 전신 파워·심폐를 동시에 자극.' where name_en='Devil Press';
update exercises set muscles=array['calves','shoulders','forearms'], helps_stations=array['run','burpee'],
  description_ko='손목으로 줄을 돌려 한 번 점프에 줄이 두 번 지나가게 한다. 낮고 빠른 점프.' where name_en='Double Unders';
update exercises set muscles=array['core','grip'], helps_stations=array['sledpull','farmers'],
  description_ko='바에 매달려 반동 없이 다리를 들어 올린다. 코어와 그립을 함께 단련.' where name_en='Hanging Leg Raise';
update exercises set muscles=array['core'], helps_stations=array['ski','wallballs'],
  description_ko='허리를 바닥에 붙인 채 팔·다리를 뻗어 바나나 모양으로 버틴다.' where name_en='Hollow Hold';
update exercises set muscles=array['full_body','shoulders','back','core'], helps_stations=array['burpee'],
  description_ko='덤벨 버피 후 로우·클린·프레스를 연결하는 전신 콤플렉스.' where name_en='Man Makers';
update exercises set muscles=array['core'], helps_stations=array['farmers','lunges'],
  description_ko='밴드를 옆에서 당기는 저항에 맞서 몸통이 돌아가지 않게 버티며 팔을 뻗는다(안티로테이션).' where name_en='Pallof Press';
update exercises set muscles=array['core','shoulders'], helps_stations=array['farmers'],
  description_ko='팔꿈치와 발끝으로 몸을 일직선으로 지지한다. 엉덩이가 처지지 않게 코어를 조인다.' where name_en='Plank';
update exercises set muscles=array['core'], helps_stations=array['farmers'],
  description_ko='옆으로 누워 한쪽 팔꿈치로 몸을 일직선으로 지지한다. 측면 코어 강화.' where name_en='Side Plank';
update exercises set muscles=array['core'], helps_stations=array['wallballs'],
  description_ko='앉은 자세로 상체를 뒤로 기울여 메디신볼을 좌우로 옮기며 몸통을 회전한다.' where name_en='Russian Twist';
update exercises set muscles=array['shoulders','back','core'], helps_stations=array['wallballs','ski'],
  description_ko='볼을 머리 위로 들었다가 코어와 상체로 바닥에 힘껏 내리친다.' where name_en='Slam Balls';
update exercises set muscles=array['quads','glutes','shoulders','triceps'], helps_stations=array['wallballs'],
  description_ko='프런트 스쿼트에서 일어서는 힘으로 바벨을 머리 위로 밀어 올린다. 월볼의 핵심 패턴.' where name_en='Thrusters';
update exercises set muscles=array['core','lats','grip'], helps_stations=array['sledpull','farmers'],
  description_ko='바에 매달려 반동을 이용해 발끝을 바에 터치한다.' where name_en='Toes to Bar';
update exercises set muscles=array['core'], helps_stations=array['wallballs'],
  description_ko='누워서 팔과 다리를 동시에 들어 V자를 만들었다가 통제하며 내린다.' where name_en='V-Ups';
update exercises set muscles=array['shoulders','core','triceps'], helps_stations=array['burpee'],
  description_ko='엎드린 자세에서 발을 벽에 대고 손을 벽 쪽으로 걸어 물구나무에 가깝게 오른다.' where name_en='Wall Walks';

-- ── 모빌리티 (스트레치 부위 = 타겟) ─────────────────────────────────
update exercises set muscles=array['glutes','hamstrings'], helps_stations=array['lunges','sledpush'],
  description_ko='앞뒤 다리를 90도로 놓고 상체를 세워 앞쪽 엉덩이를 늘린다. 좌우 교대.' where name_en='90/90 Hip Stretch';
update exercises set muscles=array['shoulders'], helps_stations=array['ski','wallballs'],
  description_ko='밴드를 잡고 팔을 앞뒤·좌우로 돌려 어깨 관절을 데운다.' where name_en='Band Shoulder Warmup';
update exercises set muscles=array['calves'], helps_stations=array['run','sledpush'],
  description_ko='벽을 밀며 뒷다리를 펴 종아리를 늘린다. 무릎을 굽혀 가자미근도 함께.' where name_en='Calf Stretch';
update exercises set muscles=array['quads'], helps_stations=array['lunges','run'],
  description_ko='뒷발을 벽에 대고 무릎을 꿇어 앞벅지와 고관절 굴곡근을 늘린다.' where name_en='Couch Stretch';
update exercises set muscles=array['quads'], helps_stations=array['lunges','run'],
  description_ko='폼롤러 위에 허벅지 앞을 올리고 천천히 굴려 근막을 이완한다.' where name_en='Foam Roll Quads';
update exercises set muscles=array['back'], helps_stations=array['ski','row'],
  description_ko='등 가운데를 폼롤러에 대고 흉추를 폈다 굽혀 가동성을 늘린다.' where name_en='Foam Roll T-Spine';
update exercises set muscles=array['quads','core'], helps_stations=array['run','lunges'],
  description_ko='런지 자세에서 골반을 앞으로 밀어 뒷다리 고관절 굴곡근을 늘린다.' where name_en='Hip Flexor Stretch';
update exercises set muscles=array['chest','shoulders'], helps_stations=array['ski'],
  description_ko='문틀이나 벽에 팔을 대고 몸을 돌려 가슴을 편다.' where name_en='Pec Stretch';
update exercises set muscles=array['calves'], helps_stations=array['sledpush','lunges'],
  description_ko='무릎을 벽 쪽으로 밀어 발목 배측굴곡 가동범위를 늘린다.' where name_en='Wall Ankle Mobility';
update exercises set muscles=array['full_body'], helps_stations=array['run'],
  description_ko='런지 자세에서 팔꿈치를 안쪽 바닥에 내리고 상체를 회전해 전신을 연다.' where name_en='World''s Greatest Stretch';

-- ── 근력 ────────────────────────────────────────────────────────────
update exercises set muscles=array['quads','glutes','core'], helps_stations=array['sledpush','wallballs','lunges'],
  description_ko='바벨을 등 위에 얹고 엉덩이를 뒤로 빼며 허벅지가 수평이 될 때까지 앉았다 선다.' where name_en='Back Squat';
update exercises set muscles=array['quads','core','glutes'], helps_stations=array['wallballs','lunges'],
  description_ko='바벨을 어깨 앞에 얹고 팔꿈치를 세운 채 상체를 곧게 유지하며 스쿼트한다.' where name_en='Front Squat';
update exercises set muscles=array['back','lats','biceps'], helps_stations=array['row','sledpull'],
  description_ko='힙 힌지로 상체를 숙이고 바벨을 배꼽 쪽으로 당긴다. 등으로 당기는 감각.' where name_en='Barbell Row';
update exercises set muscles=array['back','lats','biceps'], helps_stations=array['row','sledpull'],
  description_ko='한 손을 벤치에 짚고 덤벨을 엉덩이 쪽으로 당긴다. 견갑을 모아 등을 쓴다.' where name_en='Dumbbell Row';
update exercises set muscles=array['chest','triceps','shoulders'], helps_stations=array['burpee'],
  description_ko='견갑을 모으고 바벨을 가슴까지 내렸다가 밀어 올린다.' where name_en='Bench Press';
update exercises set muscles=array['quads','glutes','hamstrings'], helps_stations=array['lunges','sledpush'],
  description_ko='뒷발을 벤치에 올리고 앞다리로 앉았다 선다. 한쪽 다리 근력·균형.' where name_en='Bulgarian Split Squat';
update exercises set muscles=array['calves'], helps_stations=array['run','sledpush'],
  description_ko='발끝으로 서서 발뒤꿈치를 최대한 올렸다 천천히 내린다.' where name_en='Calf Raise';
update exercises set muscles=array['lats','biceps','back'], helps_stations=array['sledpull'],
  description_ko='손바닥을 몸 쪽으로 잡고 턱이 바를 넘도록 당겨 올린다.' where name_en='Chin Ups';
update exercises set muscles=array['lats','back','biceps','grip'], helps_stations=array['sledpull','farmers'],
  description_ko='손등을 앞으로 잡고 견갑을 내리며 턱이 바를 넘도록 당긴다.' where name_en='Pull Ups';
update exercises set muscles=array['full_body','shoulders','quads'], helps_stations=array['wallballs','sledpush'],
  description_ko='바닥에서 클린으로 어깨에 받은 뒤 저크로 머리 위까지 밀어 올린다.' where name_en='Clean & Jerk';
update exercises set muscles=array['full_body','traps','glutes'], helps_stations=array['wallballs','sledpull'],
  description_ko='힙 힌지에서 폭발적으로 바벨을 당겨 어깨에 받는다. 삼중 신전 파워.' where name_en='Power Clean';
update exercises set muscles=array['full_body','shoulders','glutes'], helps_stations=array['wallballs'],
  description_ko='바닥에서 한 동작으로 바벨을 머리 위까지 끌어올린다. 최고난도 전신 파워.' where name_en='Snatch';
update exercises set muscles=array['grip','forearms','lats'], helps_stations=array['farmers','sledpull'],
  description_ko='바에 힘을 빼고 매달려 그립 지구력과 어깨 감압을 기른다.' where name_en='Dead Hang';
update exercises set muscles=array['back','glutes','hamstrings','core'], helps_stations=array['sledpull','farmers'],
  description_ko='바를 정강이 가까이 두고 힙 힌지로 지면에서 끌어올린다. 등을 중립으로 유지.' where name_en='Deadlift';
update exercises set muscles=array['hamstrings','glutes','back'], helps_stations=array['sledpull','run'],
  description_ko='무릎을 살짝 굽힌 채 힙 힌지로 바를 정강이까지 내려 햄스트링을 늘렸다 선다.' where name_en='Romanian Deadlift';
update exercises set muscles=array['back','glutes','quads','grip'], helps_stations=array['sledpull','farmers'],
  description_ko='트랩바 안에 서서 손잡이를 잡고 다리와 등으로 들어 올린다. 허리 부담이 적다.' where name_en='Trap Bar Deadlift';
update exercises set muscles=array['chest','triceps','shoulders'], helps_stations=array['burpee'],
  description_ko='딥바에서 몸을 내려 팔꿈치를 90도까지 굽혔다가 밀어 올린다.' where name_en='Dips';
update exercises set muscles=array['chest','triceps','shoulders','core'], helps_stations=array['burpee'],
  description_ko='몸을 일직선으로 유지하며 가슴이 바닥에 닿을 때까지 내렸다 민다.' where name_en='Push Ups';
update exercises set muscles=array['core','shoulders','traps'], helps_stations=array['farmers','lunges'],
  description_ko='케틀벨을 가슴 앞 랙 자세로 들고 코어를 세운 채 걷는다.' where name_en='Front Rack Carry';
update exercises set muscles=array['shoulders','core','traps'], helps_stations=array['farmers'],
  description_ko='무게를 머리 위로 팔을 편 채 들고 코어를 조여 걷는다. 어깨 안정성.' where name_en='Overhead Carry';
update exercises set muscles=array['core','grip','forearms'], helps_stations=array['farmers'],
  description_ko='한 손에만 무게를 들고 몸이 기울지 않게 버티며 걷는다(안티-측면굴곡).' where name_en='Suitcase Carry';
update exercises set muscles=array['core','traps','back','grip'], helps_stations=array['farmers','lunges'],
  description_ko='샌드백을 한쪽 어깨에 메고 코어로 균형을 잡으며 걷는다.' where name_en='Sandbag Shoulder Carry';
update exercises set muscles=array['full_body','traps','core','grip'], helps_stations=array['farmers','sledpush'],
  description_ko='요크를 어깨에 지고 짧고 빠른 보폭으로 걷는다. 전신 안정성·그립.' where name_en='Yoke Carry';
update exercises set muscles=array['glutes','hamstrings'], helps_stations=array['sledpush','lunges'],
  description_ko='등을 바닥에 대고 발로 밀어 엉덩이를 들어 올려 둔근을 조인다.' where name_en='Glute Bridge';
update exercises set muscles=array['glutes','hamstrings'], helps_stations=array['sledpush','sledpull'],
  description_ko='등을 벤치에 대고 바벨을 골반에 올려 엉덩이를 밀어 올린다. 둔근 파워.' where name_en='Hip Thrust';
update exercises set muscles=array['quads','glutes','core'], helps_stations=array['wallballs','lunges'],
  description_ko='케틀벨을 가슴 앞에 들고 상체를 세운 채 깊게 앉았다 선다.' where name_en='Goblet Squat';
update exercises set muscles=array['quads','glutes','hamstrings'], helps_stations=array['sledpush','lunges'],
  description_ko='머신에 앉아 발판을 밀어 다리를 펴고 통제하며 굽힌다.' where name_en='Leg Press';
update exercises set muscles=array['hamstrings'], helps_stations=array['run','sledpull'],
  description_ko='발목을 고정하고 상체를 곧게 유지한 채 천천히 앞으로 내려가 햄스트링으로 버틴다.' where name_en='Nordic Curl';
update exercises set muscles=array['shoulders','triceps','core'], helps_stations=array['ski','wallballs'],
  description_ko='바벨을 어깨에서 반동 없이 머리 위로 밀어 올린다. 코어로 몸통을 고정.' where name_en='Overhead Press';
update exercises set muscles=array['shoulders','triceps','quads'], helps_stations=array['wallballs','ski'],
  description_ko='다리의 살짝 반동(딥)을 이용해 바벨을 머리 위로 밀어 올린다.' where name_en='Push Press';
update exercises set muscles=array['quads','glutes','calves'], helps_stations=array['lunges','sledpush'],
  description_ko='박스에 한 발을 올리고 그 다리 힘으로 올라섰다 내려온다.' where name_en='Step Ups';
update exercises set muscles=array['quads','glutes','hamstrings'], helps_stations=array['lunges'],
  description_ko='덤벨을 들고 앞으로 걸으며 뒷무릎이 바닥에 닿을 때까지 런지한다.' where name_en='Walking Lunge';
