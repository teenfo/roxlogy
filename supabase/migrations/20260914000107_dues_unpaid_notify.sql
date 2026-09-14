-- ============================================================
-- Roxlogy — 회비 미납 알림 (운영진이 눌러서 보낸다)
--
-- 회계 시안의 "확인할 일" 카드에 있던 "알림 보내기" 버튼. 크론이 아니라 운영진이
-- 누를 때만 나간다 — 독촉은 사람이 판단할 일이지 매일 자동으로 갈 일이 아니다.
--
-- 프로듀서는 HTTP 를 모른다: enqueue_notification 으로 아웃박스에 행만 넣고
-- push-dispatch 크론이 실제로 보낸다(기존 설계 그대로). 종류별 옵트아웃도
-- enqueue_notification 이 존중하므로 여기서 따로 보지 않는다.
--
-- 두 가지를 특히 신경 썼다:
--  1) **연타 방지** — 같은 사람에게 같은 달 독촉을 6시간 안에 두 번 보내지 않는다.
--     운영진이 버튼을 두 번 누르는 건 흔한 일이고, 받는 쪽에는 그게 스팸이다.
--     같은 달인지 구분하려고 URL 에 기간을 박는다(/crews/<slug>?dues=YYYY-MM).
--  2) **보냈다고 거짓말하지 않기** — enqueue_notification 은 옵트아웃이면 조용히
--     아무것도 안 한다. 그래서 인큐 직후 실제로 행이 생겼는지 확인해 세고,
--     대상·발송·건너뜀을 나눠 돌려준다. 화면은 그 숫자를 그대로 적는다.
-- ============================================================

insert into public.notification_types(key, description, default_enabled)
values ('dues_unpaid', '크루 회비 미납 안내', true)
on conflict (key) do nothing;

create or replace function public.notify_unpaid_dues(p_crew uuid, p_period text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
  v_slug text;
  v_name text;
  v_url text;
  v_title text;
  v_body text;
  v_amount text;
  v_targets int := 0;
  v_sent int := 0;
  v_recent int := 0;
  v_optout int := 0;
  -- now() 는 트랜잭션 시각이라 이 호출에서 생긴 행만 정확히 골라낸다
  v_started timestamptz := now();
begin
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'dues_bad_period'; end if;

  select c.slug, c.name into v_slug, v_name from crews c where c.id = p_crew;
  if v_slug is null then raise exception 'crew_not_found'; end if;

  if not ((select is_crew_staff(p_crew)) or (select is_admin())) then
    raise exception 'dues_not_staff';
  end if;

  v_url := '/crews/' || v_slug || '?dues=' || p_period;

  for r in
    select ch.user_id,
           count(*)::int as n,
           sum(ch.amount)::int as amount,
           coalesce(p.locale, 'ko') as loc
      from crew_dues_charges ch
      join profiles p on p.id = ch.user_id
     where ch.crew_id = p_crew
       and ch.period = p_period
       and ch.status in ('pending', 'reported')
     group by ch.user_id, p.locale
  loop
    v_targets := v_targets + 1;

    -- 1) 연타 방지 — 같은 달 독촉이 최근 6시간 안에 나갔으면 건너뛴다
    if exists (
      select 1 from notifications n
       where n.user_id = r.user_id
         and n.type_key = 'dues_unpaid'
         and n.url = v_url
         and n.created_at > v_started - interval '6 hours'
    ) then
      v_recent := v_recent + 1;
      continue;
    end if;

    v_amount := '₩' || to_char(r.amount, 'FM999,999,999');
    v_title := case r.loc
      when 'en' then 'Unpaid dues'
      when 'es' then 'Cuotas pendientes'
      else '회비 미납 안내' end;
    v_body := case r.loc
      when 'en' then v_name || ' · ' || p_period || ' — ' || r.n ||
        ' unpaid charge(s), ' || v_amount ||
        '. Tap "I paid" once you have sent it.'
      when 'es' then v_name || ' · ' || p_period || ' — ' || r.n ||
        ' cargo(s) pendiente(s), ' || v_amount ||
        '. Pulsa "He pagado" cuando lo hayas enviado.'
      else v_name || ' · ' || p_period || ' 미납 ' || r.n || '건 ' || v_amount ||
        '. 납부하셨다면 "납부 신고"를 눌러 주세요.' end;

    perform enqueue_notification(r.user_id, 'dues_unpaid', v_title, v_body, v_url);

    -- 2) 옵트아웃이면 enqueue 가 조용히 아무것도 안 한다 — 실제로 들어갔는지 본다
    if exists (
      select 1 from notifications n
       where n.user_id = r.user_id
         and n.type_key = 'dues_unpaid'
         and n.url = v_url
         and n.created_at >= v_started
    ) then
      v_sent := v_sent + 1;
    else
      v_optout := v_optout + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'targets', v_targets, 'sent', v_sent, 'recent', v_recent, 'optout', v_optout
  );
end $$;

revoke all on function public.notify_unpaid_dues(uuid, text) from public, anon;
grant execute on function public.notify_unpaid_dues(uuid, text) to authenticated;

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_crew uuid;
  v_slug text;
  v_period text;
  v_staff uuid;
  v_member uuid;
  v_res jsonb;
  v_started timestamptz := now();
  v_ok boolean;
begin
  -- 미납 청구가 있는 크루를 하나 찾는다. 없으면 발송 검사는 건너뛴다.
  select ch.crew_id, ch.user_id, ch.period into v_crew, v_member, v_period
    from crew_dues_charges ch
   where ch.status in ('pending', 'reported')
   limit 1;
  if v_crew is null then
    raise notice '가드: 미납 청구가 없어 발송 검사를 건너뛴다';
    return;
  end if;
  select slug into v_slug from crews where id = v_crew;
  select user_id into v_staff from crew_members
   where crew_id = v_crew and role in ('owner', 'coach') and status = 'active'
   limit 1;

  -- 1) 운영진이 아니면 막힌다
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  v_ok := false;
  begin
    perform notify_unpaid_dues(v_crew, v_period);
  exception when others then
    if sqlerrm like '%dues_not_staff%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception '가드: 일반 회원이 미납 알림을 보냈다'; end if;

  if v_staff is null then
    raise notice '가드: 운영진이 없어 발송 검사를 건너뛴다';
    perform set_config('request.jwt.claims', null, true);
    return;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  -- 2) 기간 형식 검사
  v_ok := false;
  begin
    perform notify_unpaid_dues(v_crew, '2026-9');
  exception when others then
    if sqlerrm like '%dues_bad_period%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception '가드: 잘못된 기간이 통과했다'; end if;

  -- 3) 실제 발송 — 대상 수와 발송/옵트아웃 합이 맞아야 한다
  v_res := notify_unpaid_dues(v_crew, v_period);
  if (v_res ->> 'targets')::int = 0 then
    raise exception '가드: 미납자가 있는데 대상이 0이다 (%)', v_res;
  end if;
  if (v_res ->> 'sent')::int + (v_res ->> 'optout')::int <> (v_res ->> 'targets')::int then
    raise exception '가드: 대상 수와 발송/옵트아웃 합이 다르다 (%)', v_res;
  end if;

  -- 4) 연타 방지 — 바로 다시 누르면 한 건도 안 나간다
  v_res := notify_unpaid_dues(v_crew, v_period);
  if (v_res ->> 'sent')::int <> 0 then
    raise exception '가드: 연달아 눌렀는데 또 나갔다 (%)', v_res;
  end if;

  -- 검사로 넣은 알림은 지운다 (이 트랜잭션에서 생긴 행만)
  delete from notifications
   where type_key = 'dues_unpaid' and created_at >= v_started;

  perform set_config('request.jwt.claims', null, true);
end $$;
