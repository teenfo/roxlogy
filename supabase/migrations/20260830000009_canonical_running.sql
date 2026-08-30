-- ============================================================
-- Roxlogy — 러닝 운동 정규화 (거리 변형 → 정규 '러닝' 1개 + note 거리)
--
-- 스테이션 정규화(20260830000008)와 같은 원칙의 후속:
--   · '러닝 1km' 중복 행 2개 발견 (시드 01 코어 행 + 시드 04 확장 행)
--   · 러닝 400m/800m/1km/1.6km/3km/5km/10km 거리 변형은 워크아웃
--     아이템의 target(note) 거리 표기로 해소한다.
-- 세션 세그먼트가 참조하는 코어 행을 정규 '러닝'으로 개명하고
-- (기존 이름은 별칭으로 보존), 변형 행의 아이템·세그먼트 참조를
-- 정규 행으로 이전한다. note 에 거리가 없으면 앞에 붙여 보존한다.
-- 템포런·지속주·인터벌·힐 스프린트 등 훈련 유형이 다른 러닝
-- 종목은 그대로 유지한다. 시드 01(정규명)·04(변형 제거)도 갱신.
-- ============================================================

do $$
declare
  v_keep uuid;
  v_old record;
  v_label text;
begin
  -- 정규 = 세션 세그먼트가 가장 많이 참조하는 거리 변형 행 (코어 시드)
  select e.id into v_keep from exercises e
  where e.name_ko ~ '^러닝 [0-9]'
  order by (select count(*) from session_segments s where s.exercise_id = e.id) desc,
           e.created_at
  limit 1;
  if v_keep is null then
    raise exception 'canonical running row not found';
  end if;

  for v_old in select e.id, e.name_ko, e.name_en from exercises e
    where e.name_ko ~ '^러닝 [0-9]' and e.id <> v_keep
  loop
    v_label := coalesce(
      nullif((regexp_match(v_old.name_ko, '^러닝\s+(.+)$'))[1], ''), '');
    -- 아이템 참조 이전 — note 에 거리가 이미 있으면 그대로, 없으면 앞에 붙임
    update workout_template_items i
    set exercise_id = v_keep,
        target = jsonb_build_object('note', trim(both ' ·' from
          case when position(v_label in coalesce(i.target->>'note', '')) > 0
               then coalesce(i.target->>'note', '')
               else v_label || case when nullif(i.target->>'note', '') is not null
                                    then ' · ' || (i.target->>'note') else '' end
          end))
    where i.exercise_id = v_old.id;
    update session_segments set exercise_id = v_keep where exercise_id = v_old.id;
    -- 변형 이름을 정규 별칭으로 보존
    update exercises e
    set aliases = (select array_agg(distinct a)
                   from unnest(e.aliases || v_old.name_ko || v_old.name_en) a)
    where e.id = v_keep;
    delete from exercises where id = v_old.id;
  end loop;

  -- 정규 개명 + 기존 이름 별칭 보존
  update exercises e
  set aliases = (select array_agg(distinct a)
                 from unnest(e.aliases || e.name_ko || e.name_en) a),
      name_ko = '러닝',
      name_en = 'Running'
  where e.id = v_keep;
end $$;

do $$
begin
  if (select count(*) from exercises where name_ko ~ '^러닝') <> 1 then
    raise exception 'expected exactly 1 canonical running exercise';
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
