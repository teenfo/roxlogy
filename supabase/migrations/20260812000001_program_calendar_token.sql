-- ============================================================
-- Roxlogy — 프로그램 캘린더 구독 토큰
--
-- 구글/애플 캘린더의 "URL 로 추가"(구독)는 로그인 없이 서버가 주기적으로
-- .ics 를 다시 읽는 방식이라, 세션 쿠키 대신 프로그램별 비밀 토큰으로
-- 인증한다. 토큰이 곧 자격증명 — URL 을 아는 사람만 일정을 읽을 수 있다.
-- program_calendar() RPC 는 토큰이 맞을 때만 프로그램 트리를 반환한다
-- (SECURITY DEFINER 로 RLS 우회, 비로그인 fetch 대응).
-- ============================================================

alter table public.programs
  add column if not exists calendar_token text not null
    default encode(gen_random_bytes(16), 'hex');

create index if not exists programs_calendar_token_idx
  on public.programs (calendar_token);

create or replace function public.program_calendar(p_id uuid, p_token text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'start_date', p.start_date,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'day_index', d.day_index,
        'focus', d.focus,
        'notes', d.notes,
        'workouts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'title', w.title,
            'items', coalesce((
              select jsonb_agg(jsonb_build_object(
                'note', i.target->>'note',
                'name_ko', e.name_ko,
                'name_en', e.name_en
              ) order by i.seq)
              from workout_template_items i
              left join exercises e on e.id = i.exercise_id
              where i.template_id = w.id), '[]'::jsonb)
          ) order by w.created_at)
          from workout_templates w
          where w.program_day_id = d.id), '[]'::jsonb)
      ) order by d.day_index)
      from program_days d
      where d.program_id = p.id), '[]'::jsonb)
  )
  from programs p
  where p.id = p_id and p.calendar_token = p_token;
$$;
