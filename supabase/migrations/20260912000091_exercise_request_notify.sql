-- ============================================================
-- Roxlogy — 운동 등록 요청: 관리자 알림 + 대기 항목 수 조회
--
-- 1) notification_types 에 'exercise_request' (관리자용) 추가.
-- 2) exercise_requests AFTER INSERT 트리거 → 활성 관리자 전원에게 알림 인큐
--    (enqueue_notification 이 종류별 옵트아웃을 존중, push-dispatch 크론이 발송).
--    출처(AI/MCP/사용자)는 요청 메모 접두어로 구분해 본문에 적는다.
-- 3) admin_exercise_request_waiting(): pending 요청별 대기 항목 수·프로그램 수.
--    workout_template_items 는 RLS 가 공개/본인 프로그램만 보여 주므로 관리자용
--    SECURITY DEFINER RPC 로 센다(is_admin 검사, authenticated 에 grant).
-- ============================================================

insert into public.notification_types(key, description, default_enabled)
values ('exercise_request', '운동 등록 요청 (관리자)', true)
on conflict (key) do nothing;

create or replace function public.notify_exercise_request()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_name text;
  v_src text;
  v_title text;
  v_body text;
begin
  if new.status is distinct from 'pending' then return null; end if;
  select nullif(p.display_name, '') into v_name from profiles p where p.id = new.requested_by;
  v_src := case
    when new.note like 'AI 프로그램 생성에서 자동 요청%' then 'ai'
    when new.note like 'MCP 프로그램 등록에서 자동 요청%' then 'mcp'
    else 'user' end;
  for r in
    select p.id, coalesce(p.locale, 'ko') as loc
    from profiles p
    where p.is_admin and not p.disabled
  loop
    v_title := case r.loc when 'en' then 'New exercise request'
                          when 'es' then 'Nueva solicitud de ejercicio'
                          else '새 운동 등록 요청' end;
    v_body := case r.loc
      when 'en' then '"' || new.name_ko || '" — ' ||
        case v_src when 'ai' then 'from AI program generation'
                   when 'mcp' then 'from an MCP program'
                   else 'from ' || coalesce(v_name, 'a user') end ||
        '. Approve it to fill the waiting program items.'
      when 'es' then '"' || new.name_ko || '" — ' ||
        case v_src when 'ai' then 'de la generación de programas con IA'
                   when 'mcp' then 'de un programa por MCP'
                   else 'de ' || coalesce(v_name, 'un usuario') end ||
        '. Apruébala para completar los ítems en espera.'
      else '"' || new.name_ko || '" — ' ||
        case v_src when 'ai' then 'AI 프로그램 생성'
                   when 'mcp' then 'MCP 프로그램 등록'
                   else coalesce(v_name, '사용자') || '님 요청' end ||
        '. 승인하면 대기 중인 프로그램 항목이 채워집니다.' end;
    perform enqueue_notification(r.id, 'exercise_request', v_title, v_body, '/admin/content');
  end loop;
  return null;
end; $$;
revoke all on function public.notify_exercise_request() from public, anon, authenticated;
drop trigger if exists notify_exercise_request on public.exercise_requests;
create trigger notify_exercise_request
  after insert on public.exercise_requests
  for each row execute function public.notify_exercise_request();

create or replace function public.admin_exercise_request_waiting()
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select case when is_admin() then coalesce((
    select jsonb_object_agg(x.request_id, jsonb_build_object('items', x.items, 'programs', x.programs))
    from (
      select i.exercise_request_id as request_id,
             count(*) as items,
             count(distinct d.program_id) as programs
      from workout_template_items i
      join workout_templates t on t.id = i.template_id
      join program_days d on d.id = t.program_day_id
      join exercise_requests r on r.id = i.exercise_request_id and r.status = 'pending'
      where i.exercise_id is null
      group by i.exercise_request_id) x), '{}'::jsonb)
  else null end;
$$;
revoke all on function public.admin_exercise_request_waiting() from public;
grant execute on function public.admin_exercise_request_waiting() to authenticated;
comment on function public.admin_exercise_request_waiting() is
  '관리자용: pending 운동 등록 요청별 대기 항목 수·프로그램 수 {request_id: {items, programs}}. 비관리자는 null.';

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_uid uuid; v_admin uuid; v_rid uuid; v_n int; j jsonb;
  v_name text := 'zz알림가드' || substr(gen_random_uuid()::text, 1, 6);
begin
  select id into v_admin from public.profiles where is_admin and not disabled limit 1;
  select id into v_uid from public.profiles where not disabled and not is_admin limit 1;
  if v_admin is null then raise notice '가드 건너뜀: 관리자 없음'; return; end if;
  v_uid := coalesce(v_uid, v_admin);

  v_rid := public.ensure_exercise_request(v_uid, v_name, 'AI 프로그램 생성에서 자동 요청 — 가드');
  select count(*) into v_n from public.notifications
   where type_key = 'exercise_request' and user_id = v_admin and url = '/admin/content'
     and body like '%' || v_name || '%' and sent_at is null;
  if v_n < 1 then raise exception '가드: 관리자 알림이 인큐되지 않았다'; end if;
  if not exists (select 1 from public.notifications
                  where type_key = 'exercise_request' and body like '%' || v_name || '%AI 프로그램 생성%') then
    raise exception '가드: 출처(AI)가 본문에 없다'; end if;

  -- 대기 항목 수
  insert into public.workout_template_items (template_id, seq, exercise_request_id, pending_exercise)
  select t.id, 99, v_rid, v_name from public.workout_templates t limit 1;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  j := public.admin_exercise_request_waiting();
  if (j->v_rid::text->>'items')::int is distinct from 1 then
    raise exception '가드: 대기 항목 수가 틀리다 %', j->v_rid::text; end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  if v_uid <> v_admin and public.admin_exercise_request_waiting() is not null then
    raise exception '가드: 비관리자에게 대기 수가 노출된다'; end if;
  perform set_config('request.jwt.claims', '', true);

  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
