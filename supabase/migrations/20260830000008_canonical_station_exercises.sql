-- ============================================================
-- Roxlogy — 스테이션 운동 정규화 (구간 변형 → 정규 1개 + note 볼륨)
--
-- 구간·강도별 변형 등록은 워크아웃 아이템의 target(note) 입력으로
-- 해소한다. 세션 기록이 참조하는 레이스 규격 행을 정규 운동으로
-- 개명하고(기존 이름은 별칭으로 보존), 변형 행의 아이템 참조는
-- 정규 운동 + note 로 이전한 뒤 미참조 변형을 삭제한다.
-- 시드도 함께 갱신: 01은 정규명, 04의 구간 변형 시드는 제거.
-- ============================================================

do $$
declare
  m record;
  v_keep uuid;
  v_old record;
  v_label text;
begin
  for m in select * from (values
    ('station_1', '스키에르그', 'SkiErg'),
    ('station_2', '슬레드 푸시', 'Sled Push'),
    ('station_3', '슬레드 풀', 'Sled Pull'),
    ('station_4', '버피 브로드점프', 'Burpee Broad Jumps'),
    ('station_5', '로잉', 'Rowing'),
    ('station_6', '파머스 캐리', 'Farmers Carry'),
    ('station_7', '샌드백 런지', 'Sandbag Lunges'),
    ('station_8', '월볼', 'Wall Balls')
  ) as t(st, ko, en)
  loop
    -- 정규 = 세션 세그먼트가 가장 많이 참조하는 행 (레이스 규격)
    select e.id into v_keep from exercises e
    where e.station_type = m.st
    order by (select count(*) from session_segments s where s.exercise_id = e.id) desc,
             e.created_at
    limit 1;

    -- 변형 행 처리: 아이템 참조는 정규 + note 로 이전
    for v_old in select e.id, e.name_ko from exercises e
      where e.station_type = m.st and e.id <> v_keep
    loop
      v_label := coalesce(
        nullif((regexp_match(v_old.name_ko, '\(([^)]+)\)'))[1], ''),
        nullif((regexp_match(v_old.name_ko, '(\d+\s?(?:m|회))\s*$'))[1], ''),
        '');
      update workout_template_items i
      set exercise_id = v_keep,
          target = jsonb_build_object('note', trim(both ' ·' from
            v_label || case when nullif(i.target->>'note', '') is not null
                            then ' · ' || (i.target->>'note') else '' end))
      where i.exercise_id = v_old.id;
      update session_segments set exercise_id = v_keep where exercise_id = v_old.id;
      delete from exercises where id = v_old.id;
    end loop;

    -- 정규 개명 + 기존 레이스 규격 이름을 별칭으로 보존
    update exercises e
    set aliases = (select array_agg(distinct a) from unnest(e.aliases || e.name_ko || e.name_en) a),
        name_ko = m.ko,
        name_en = m.en
    where e.id = v_keep;
  end loop;
end $$;

do $$
begin
  if (select count(*) from exercises where station_type is not null) <> 8 then
    raise exception 'expected 8 canonical station exercises';
  end if;
  if exists (select 1 from workout_template_items i
             left join exercises e on e.id = i.exercise_id
             where i.exercise_id is not null and e.id is null) then
    raise exception 'orphan workout items';
  end if;
  if exists (select 1 from session_segments s
             left join exercises e on e.id = s.exercise_id
             where s.exercise_id is not null and e.id is null) then
    raise exception 'orphan segments';
  end if;
end $$;
