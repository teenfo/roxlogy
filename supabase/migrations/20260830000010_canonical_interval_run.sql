-- ============================================================
-- Roxlogy — 인터벌 러닝 정규화 + 운동 목록 알파벳순 정렬
--
-- 러닝 정규화(20260830000009) 후에도 이름에 거리·횟수가 박힌
-- 러닝 종목이 남아 있었다: '인터벌 400m×8', '인터벌 1km×5'.
-- 같은 원칙(볼륨은 워크아웃 아이템 note)으로 정규 '인터벌 러닝'
-- 1종으로 통합한다 (기존 이름은 별칭 보존, 참조 이전).
-- mcp_exercises 목록도 스테이션 우선 → 이름 알파벳순으로 변경.
-- ============================================================

do $$
declare
  v_keep uuid;
  v_old record;
begin
  select e.id into v_keep from exercises e
  where e.name_ko ~ '^인터벌 [0-9]'
  order by (select count(*) from session_segments s where s.exercise_id = e.id) desc,
           e.created_at, e.name_ko
  limit 1;
  if v_keep is null then return; end if;  -- 이미 정리됨 (재실행 안전)

  for v_old in select e.id, e.name_ko, e.name_en from exercises e
    where e.name_ko ~ '^인터벌 [0-9]' and e.id <> v_keep
  loop
    -- 참조 이전 (현재 0건이지만 방어적으로) — 원래 이름을 note 로 보존
    update workout_template_items i
    set exercise_id = v_keep,
        target = jsonb_build_object('note', trim(both ' ·' from
          v_old.name_ko || case when nullif(i.target->>'note', '') is not null
                                then ' · ' || (i.target->>'note') else '' end))
    where i.exercise_id = v_old.id;
    update session_segments set exercise_id = v_keep where exercise_id = v_old.id;
    update exercises e
    set aliases = (select array_agg(distinct a)
                   from unnest(e.aliases || v_old.name_ko || v_old.name_en) a)
    where e.id = v_keep;
    delete from exercises where id = v_old.id;
  end loop;

  update exercises e
  set aliases = (select array_agg(distinct a)
                 from unnest(e.aliases || e.name_ko || e.name_en) a),
      name_ko = '인터벌 러닝',
      name_en = 'Interval Run'
  where e.id = v_keep;
end $$;

do $$
begin
  if exists (select 1 from exercises where name_ko ~ '[0-9]+\s?(m|km)(×|x)') then
    raise exception 'volume-in-name exercises remain';
  end if;
  if exists (select 1 from workout_template_items i
             left join exercises e on e.id = i.exercise_id
             where i.exercise_id is not null and e.id is null) then
    raise exception 'orphan workout items';
  end if;
end $$;

-- MCP 운동 목록: 이름 알파벳(가나다)순
create or replace function public.mcp_exercises(p_token text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if mcp_uid(p_token) is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'name_ko', e.name_ko, 'name_en', e.name_en,
      'aliases', to_jsonb(e.aliases),
      'station_type', e.station_type, 'category', e.category)
      order by e.name_ko)
    from exercises e), '[]'::jsonb);
end; $$;
