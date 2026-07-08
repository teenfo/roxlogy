-- ============================================================
-- Roxlogy — 012 공개 프로그램 복제 (clone_program)
--
-- 공개(is_public) 또는 본인 프로그램의 전체 트리(일자→워크아웃→항목)를
-- 본인 소유로 깊은 복사한다. security invoker(기본) — 호출자 권한으로 실행되어
-- 읽기는 공개/본인 RLS, 쓰기는 본인 소유 RLS가 그대로 적용된다.
-- 복제본은 항상 비공개(is_public=false)로 생성.
-- ============================================================

create or replace function public.clone_program(
  p_source uuid,
  p_title  text default null
)
returns uuid
language plpgsql
as $$
declare
  v_new    uuid := gen_random_uuid();
  src      programs%rowtype;
  d        program_days%rowtype;
  new_day  uuid;
  w        workout_templates%rowtype;
  new_tmpl uuid;
begin
  -- RLS: 공개 또는 본인 프로그램만 조회됨
  select * into src from programs where id = p_source;
  if src.id is null then
    raise exception 'program not found or not accessible';
  end if;

  insert into programs (id, owner_id, title, description, weeks, level, is_public)
  values (
    v_new, auth.uid(),
    coalesce(nullif(p_title, ''), src.title || ' (copy)'),
    src.description, src.weeks, src.level, false
  );

  for d in
    select * from program_days where program_id = p_source order by day_index
  loop
    new_day := gen_random_uuid();
    insert into program_days (id, program_id, day_index, focus, notes)
    values (new_day, v_new, d.day_index, d.focus, d.notes);

    for w in
      select * from workout_templates where program_day_id = d.id
    loop
      new_tmpl := gen_random_uuid();
      insert into workout_templates (id, program_day_id, title, type, structure)
      values (new_tmpl, new_day, w.title, w.type, w.structure);

      insert into workout_template_items (id, template_id, seq, exercise_id, target)
      select gen_random_uuid(), new_tmpl, seq, exercise_id, target
      from workout_template_items
      where template_id = w.id;
    end loop;
  end loop;

  return v_new;
end;
$$;

grant execute on function public.clone_program(uuid, text) to authenticated;
