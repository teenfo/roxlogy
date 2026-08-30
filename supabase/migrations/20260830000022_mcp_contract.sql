-- ============================================================
-- Roxlogy — 시스템 감사 수리 (10) MCP 계약 정합
--
-- 1) list_sessions / list_races / list_pending_members 가 무효 토큰·무권한에도
--    '[]' 를 돌려줘, 일반 멤버가 "대기자 없음"으로, 토큰 오류가 "기록 없음"으로
--    오인됐다. serverInfo.instructions 의 규약대로 null 을 돌려주고,
--    route.ts 의 out() 이 {"error":"not_found_or_invalid_token"} 으로 바꾼다.
-- 2) create_program 이 weeks×7 범위를 벗어난 day_index 를 조용히 건너뛰고
--    성공 응답을 줬다 — 미등록 운동은 전체 거부하는 엄격함과 어긋난다.
--    이제 검증을 먼저 돌려 하나라도 어긋나면 아무것도 만들지 않는다.
-- ============================================================

create or replace function public.mcp_sessions(p_token text, p_limit integer default 20)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token);
begin
  if v_uid is null then return null; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.started_at desc)
    from (
      select s.id, s.started_at, s.total_time_ms, s.source_device, s.division,
             r.event as race_event, r.event_date as race_date
      from sessions s
      left join race_results r on r.id = s.race_result_id
      where s.user_id = v_uid and s.deleted_at is null
      order by s.started_at desc
      limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ) t), '[]'::jsonb);
end; $$;
grant execute on function public.mcp_sessions(text, integer) to anon, authenticated;

create or replace function public.mcp_races(p_token text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token);
begin
  if v_uid is null then return null; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.event_date desc nulls last)
    from (
      select r.id, r.event, r.event_date, r.division, r.season, r.total_time_ms,
             r.splits->>'bib' as bib,
             (r.splits->>'rank_overall')::int as rank_overall,
             (r.splits->>'field_size')::int as field_size
      from race_results r
      where r.user_id = v_uid
    ) t), '[]'::jsonb);
end; $$;
grant execute on function public.mcp_races(text) to anon, authenticated;

create or replace function public.mcp_pending_members(p_token text, p_slug text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew(p_token, p_slug);
begin
  if v_crew is null then return null; end if;  -- 운영진이 아니면 '대기자 없음'이 아니다
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'display_name', p.display_name,
        'requested_at', m.joined_at) order by m.joined_at)
    from crew_members m
    join profiles p on p.id = m.user_id
    where m.crew_id = v_crew and m.status = 'pending'), '[]'::jsonb);
end; $$;
grant execute on function public.mcp_pending_members(text, text) to anon, authenticated;

create or replace function public.mcp_create_program(
  p_token text, p_title text, p_weeks int, p_days jsonb,
  p_level text default 'intermediate', p_description text default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := mcp_uid(p_token);
  v_id uuid;
  v_n int := 0;
  v_w int := 0;
  d jsonb;
  v_idx int;
  v_day_id uuid;
  v_err jsonb;
begin
  if v_uid is null then return null; end if;
  if p_title is null or length(trim(p_title)) = 0
     or p_weeks is null or p_weeks < 1 or p_weeks > 20
     or p_level not in ('beginner', 'intermediate', 'advanced', 'elite')
     or p_days is null or jsonb_typeof(p_days) <> 'array'
     or jsonb_array_length(p_days) = 0 or jsonb_array_length(p_days) > 140 then
    return jsonb_build_object('error', 'invalid_input');
  end if;

  -- 먼저 전 일차의 day_index 를 검증 — 하나라도 범위를 벗어나면 만들지 않는다
  for d in select * from jsonb_array_elements(p_days) loop
    v_idx := (d->>'day_index')::int;
    if v_idx is null or v_idx < 1 or v_idx > p_weeks * 7 then
      return jsonb_build_object('error', 'invalid_day_index',
        'day_index', d->>'day_index', 'max', p_weeks * 7,
        'hint', 'day_index 는 1 부터 weeks×7 사이여야 합니다. weeks 를 늘리거나 일차를 조정하세요.');
    end if;
  end loop;

  insert into programs (owner_id, title, description, weeks, level, is_public)
  values (v_uid, left(trim(p_title), 120),
          nullif(left(trim(coalesce(p_description, '')), 2000), ''),
          p_weeks, p_level, false)
  returning id into v_id;

  for d in select * from jsonb_array_elements(p_days) loop
    v_idx := (d->>'day_index')::int;
    insert into program_days (program_id, day_index, focus, notes)
    values (v_id, v_idx,
            nullif(left(trim(coalesce(d->>'focus', '')), 200), ''),
            nullif(left(trim(coalesce(d->>'notes', '')), 2000), ''))
    returning id into v_day_id;
    v_n := v_n + 1;

    if d ? 'workouts' then
      v_err := _mcp_insert_workouts(v_day_id, d->'workouts');
      if v_err is not null then
        raise exception 'MCP_WORKOUT_ERR %', v_err::text using errcode = 'P0001';
      end if;
      v_w := v_w + jsonb_array_length(d->'workouts');
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'program_id', v_id,
    'title', left(trim(p_title), 120), 'days_created', v_n,
    'workouts_created', v_w,
    'note', '프로그램은 템플릿입니다 — 시작일·반복은 웹 시작 모달(개인) 또는 attach_crew_program(크루)에서 정합니다.');
exception
  when others then
    if sqlerrm like 'MCP_WORKOUT_ERR %' then
      return substring(sqlerrm from 17)::jsonb;
    end if;
    raise;
end; $$;
grant execute on function public.mcp_create_program(text, text, int, jsonb, text, text)
  to anon, authenticated;
