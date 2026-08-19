-- ============================================================
-- Roxlogy — 프로그램 반복 스케줄링
--
-- 1주짜리 프로그램을 start~end 기간 동안 순환 반복시키는 옵션.
-- 반복 시 날짜→일차 매핑: day = ((경과일) mod 사이클길이) + 1,
-- 사이클길이 = max(day_index). end_date 이후는 스케줄 없음.
-- 캘린더(.ics)·스케줄·대시보드·폰 WOD 모두 같은 규칙을 쓴다.
-- ============================================================

alter table public.programs
  add column if not exists repeat_enabled boolean not null default false;

-- 캘린더 구독 RPC 에 end_date·repeat_enabled 포함 (반복 전개는 서버 라우트가 수행)
create or replace function public.program_calendar(p_id uuid, p_token text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'start_date', p.start_date,
    'end_date', p.end_date,
    'repeat_enabled', p.repeat_enabled,
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
