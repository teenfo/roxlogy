-- ============================================================
-- Roxlogy — MCP v3: 이번에 붙인 기능(출석·등급·회비 대사/면제·모임 상태·
-- 통계·PFT)을 토큰 API 로도 쓸 수 있게 한다. 쓰기는 전부 mcp_staff_crew 로
-- 운영진을 확인한 뒤 내부 헬퍼(rox_*, 마이그레이션 058)를 부른다 —
-- 웹과 같은 구현을 공유해 동작이 갈라지지 않는다.
-- ============================================================

-- ---------- 모임 출석 명단 (운영진)
create or replace function public.mcp_event_attendance(
  p_token text, p_slug text, p_event uuid
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew(p_token, p_slug); v_ev record;
begin
  if v_crew is null then return null; end if;
  select id, title, starts_at, fee_exempt, members_only, closed_at
    into v_ev from crew_events
   where id = p_event and crew_id = v_crew and cancelled_at is null;
  if v_ev.id is null then return jsonb_build_object('error', 'event_not_found'); end if;

  return jsonb_build_object(
    'event_id', v_ev.id, 'title', v_ev.title, 'starts_at', v_ev.starts_at,
    'fee_exempt', v_ev.fee_exempt, 'members_only', v_ev.members_only,
    'closed', v_ev.closed_at is not null,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'name', coalesce(p.display_name, 'Athlete'),
        'tier', t.name, 'rsvp', r.status,
        'checked_in', r.checked_in_at is not null,
        'charge_id', ch.id, 'fee', ch.amount, 'fee_status', ch.status)
        order by (r.checked_in_at is null), coalesce(p.display_name, 'Athlete'))
      from crew_members m
      join profiles p on p.id = m.user_id
      left join crew_member_tiers t on t.id = m.tier_id
      left join crew_event_rsvps r on r.event_id = p_event and r.user_id = m.user_id
      left join crew_dues_charges ch on ch.event_id = p_event and ch.user_id = m.user_id
                                    and ch.kind = 'session'
      where m.crew_id = v_crew and m.status = 'active'), '[]'::jsonb));
end;
$$;

-- ---------- 출석 체크 (운영진, 쓰기)
create or replace function public.mcp_check_in(
  p_token text, p_slug text, p_user_id uuid, p_event uuid, p_present boolean default true
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew(p_token, p_slug); v_name text;
begin
  if v_crew is null then return null; end if;
  perform public.rox_check_in(v_crew, p_event, p_user_id, p_present, mcp_uid(p_token));
  select display_name into v_name from profiles where id = p_user_id;
  return jsonb_build_object('ok', true, 'user', coalesce(v_name, 'Athlete'),
                            'checked_in', p_present,
                            'fee', (select jsonb_build_object('amount', amount, 'status', status)
                                      from crew_dues_charges
                                     where event_id = p_event and user_id = p_user_id
                                       and kind = 'session'));
exception when others then
  return jsonb_build_object('error', sqlerrm);
end;
$$;

-- ---------- 모임 상태 토글 (운영진, 쓰기). null 인 항목은 그대로 둔다.
create or replace function public.mcp_set_meetup_flags(
  p_token text, p_slug text, p_event uuid,
  p_fee_exempt boolean default null,
  p_members_only boolean default null,
  p_closed boolean default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew(p_token, p_slug); v_period text; v_removed int := 0;
begin
  if v_crew is null then return null; end if;
  select to_char(starts_at at time zone 'Asia/Seoul', 'YYYY-MM') into v_period
    from crew_events where id = p_event and crew_id = v_crew and cancelled_at is null;
  if v_period is null then return jsonb_build_object('error', 'event_not_found'); end if;

  update crew_events
     set fee_exempt = coalesce(p_fee_exempt, fee_exempt),
         members_only = coalesce(p_members_only, members_only),
         closed_at = case when p_closed is null then closed_at
                          when p_closed then coalesce(closed_at, now())
                          else null end
   where id = p_event;

  -- 무료로 바꾸면 그 모임의 미납 청구를 회수, 유료로 되돌리면 다시 대사
  if p_fee_exempt is true then
    delete from crew_dues_charges
     where event_id = p_event and kind = 'session' and status = 'pending';
    get diagnostics v_removed = row_count;
  elsif p_fee_exempt is false then
    perform public.rox_generate_session(v_crew, v_period, mcp_uid(p_token));
  end if;

  return (select jsonb_build_object('ok', true, 'event_id', e.id, 'title', e.title,
            'fee_exempt', e.fee_exempt, 'members_only', e.members_only,
            'closed', e.closed_at is not null, 'charges_removed', v_removed)
          from crew_events e where e.id = p_event);
end;
$$;

-- ---------- 회원 등급 목록 (크루원)
create or replace function public.mcp_crew_tiers(p_token text, p_slug text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token); v_crew uuid;
begin
  if v_uid is null then return null; end if;
  select c.id into v_crew from crews c
   join crew_members m on m.crew_id = c.id and m.user_id = v_uid and m.status = 'active'
   where c.slug = p_slug;
  if v_crew is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'tier', t.name, 'full_member', t.is_full_member,
      'monthly_fee', t.monthly_fee, 'session_fee', t.session_fee,
      'is_default', t.is_default, 'archived', t.archived_at is not null,
      'members', (select count(*) from crew_members m
                   where m.tier_id = t.id and m.status = 'active'))
      order by t.sort_order, t.name)
    from crew_member_tiers t where t.crew_id = v_crew), '[]'::jsonb);
end;
$$;

-- ---------- 등급 지정 (운영진, 쓰기) — 등급은 이름으로 받는다
create or replace function public.mcp_set_member_tier(
  p_token text, p_slug text, p_user_id uuid, p_tier text
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew(p_token, p_slug); v_tier uuid; v_name text;
begin
  if v_crew is null then return null; end if;
  select id into v_tier from crew_member_tiers
   where crew_id = v_crew and name = btrim(p_tier) and archived_at is null;
  if v_tier is null then
    return jsonb_build_object('error', 'tier_not_found',
      'available', (select jsonb_agg(name order by sort_order)
                      from crew_member_tiers
                     where crew_id = v_crew and archived_at is null));
  end if;
  if not exists (select 1 from crew_members
                  where crew_id = v_crew and user_id = p_user_id and status = 'active') then
    return jsonb_build_object('error', 'not_a_member');
  end if;
  perform set_config('rox.crew_role_bypass', '1', true);
  update crew_members set tier_id = v_tier where crew_id = v_crew and user_id = p_user_id;
  select display_name into v_name from profiles where id = p_user_id;
  return jsonb_build_object('ok', true, 'user', coalesce(v_name, 'Athlete'),
                            'tier', btrim(p_tier));
end;
$$;

-- ---------- 미납 내역 (운영진)
create or replace function public.mcp_crew_unpaid(p_token text, p_slug text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew(p_token, p_slug);
begin
  if v_crew is null then return null; end if;
  return jsonb_build_object(
    'unpaid_amount', coalesce((select sum(amount) from crew_dues_charges
                                where crew_id = v_crew and status in ('pending','reported')), 0),
    'charges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'charge_id', ch.id, 'user_id', ch.user_id,
        'name', coalesce(p.display_name, 'Athlete'),
        'period', ch.period, 'kind', ch.kind, 'label', ch.label,
        'amount', ch.amount, 'status', ch.status)
        order by coalesce(p.display_name, 'Athlete'), ch.period desc)
      from crew_dues_charges ch join profiles p on p.id = ch.user_id
      where ch.crew_id = v_crew and ch.status in ('pending','reported')), '[]'::jsonb));
end;
$$;

-- ---------- 회비 대사 (운영진, 쓰기)
create or replace function public.mcp_sync_dues(
  p_token text, p_slug text, p_month text default null, p_kind text default 'both'
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  v_period text := coalesce(p_month, to_char(app_today(), 'YYYY-MM'));
  v_actor uuid := mcp_uid(p_token);
  v_m jsonb; v_s jsonb;
begin
  if v_crew is null then return null; end if;
  if v_period !~ '^\d{4}-\d{2}$' then
    return jsonb_build_object('error', 'bad_period_format');
  end if;
  if p_kind not in ('monthly', 'session', 'both') then
    return jsonb_build_object('error', 'bad_kind');
  end if;
  if p_kind in ('monthly', 'both') then
    v_m := public.rox_generate_monthly(v_crew, v_period, v_actor);
  end if;
  if p_kind in ('session', 'both') then
    v_s := public.rox_generate_session(v_crew, v_period, v_actor);
  end if;
  return jsonb_build_object('ok', true, 'period', v_period,
                            'monthly', v_m, 'session', v_s);
end;
$$;

-- ---------- 회비 면제 (운영진, 쓰기)
create or replace function public.mcp_waive_dues(
  p_token text, p_slug text, p_charge uuid, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew(p_token, p_slug); v_owner uuid;
begin
  if v_crew is null then return null; end if;
  select crew_id into v_owner from crew_dues_charges where id = p_charge;
  if v_owner is distinct from v_crew then
    return jsonb_build_object('error', 'charge_not_in_crew');
  end if;
  perform public.rox_waive_charge(p_charge, p_reason, mcp_uid(p_token));
  return (select jsonb_build_object('ok', true, 'charge_id', ch.id, 'label', ch.label,
            'amount', ch.amount, 'status', ch.status, 'reason', ch.waive_reason)
          from crew_dues_charges ch where ch.id = p_charge);
exception when others then
  return jsonb_build_object('error', sqlerrm);
end;
$$;

-- ---------- 크루원 통계 (운영진)
create or replace function public.mcp_crew_stats(p_token text, p_slug text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid := mcp_staff_crew(p_token, p_slug);
begin
  if v_crew is null then return null; end if;
  return jsonb_build_object(
    'members', (select count(*) from crew_members
                 where crew_id = v_crew and status = 'active'),
    'pending', (select count(*) from crew_members
                 where crew_id = v_crew and status = 'pending'),
    'tiers', coalesce((
      select jsonb_agg(jsonb_build_object('tier', t.name,
        'count', (select count(*) from crew_members m
                   where m.tier_id = t.id and m.status = 'active'))
        order by t.sort_order)
      from crew_member_tiers t
      where t.crew_id = v_crew and t.archived_at is null), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'name', coalesce(p.display_name, 'Athlete'),
        'paid', (select count(*) from crew_event_rsvps r
                   join crew_events e on e.id = r.event_id
                  where r.user_id = m.user_id and e.crew_id = v_crew
                    and e.cancelled_at is null and not e.fee_exempt
                    and r.checked_in_at is not null),
        'total', (select count(*) from crew_event_rsvps r
                    join crew_events e on e.id = r.event_id
                   where r.user_id = m.user_id and e.crew_id = v_crew
                     and e.cancelled_at is null and r.checked_in_at is not null))
        order by coalesce(p.display_name, 'Athlete'))
      from crew_members m join profiles p on p.id = m.user_id
      where m.crew_id = v_crew and m.status = 'active'), '[]'::jsonb),
    'unpaid_amount', coalesce((select sum(amount) from crew_dues_charges
                                where crew_id = v_crew and status in ('pending','reported')), 0),
    'waived_amount', coalesce((select sum(amount) from crew_dues_charges
                                where crew_id = v_crew and status = 'waived'), 0));
end;
$$;

-- ---------- PFT 기록 (본인)
create or replace function public.mcp_list_pft(p_token text, p_limit int default 20)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token);
begin
  if v_uid is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'tested_on', f.tested_on, 'total_ms', f.total_ms,
      'badge', f.badge, 'scaled', f.scaled, 'location', f.location,
      'splits', jsonb_build_object(
        'run_ms', f.run_ms, 'burpee_ms', f.burpee_ms, 'lunge_ms', f.lunge_ms,
        'row_ms', f.row_ms, 'pushup_ms', f.pushup_ms, 'wallball_ms', f.wallball_ms))
      order by f.tested_on desc)
    from (select * from pft_results
           where user_id = v_uid and deleted_at is null
           order by tested_on desc limit least(coalesce(p_limit, 20), 100)) f),
    '[]'::jsonb);
end;
$$;

create or replace function public.mcp_add_pft(
  p_token text, p_total_ms int, p_tested_on date default null,
  p_run_ms int default null, p_burpee_ms int default null, p_lunge_ms int default null,
  p_row_ms int default null, p_pushup_ms int default null, p_wallball_ms int default null,
  p_scaled boolean default false, p_location text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := mcp_uid(p_token); v_id uuid; v_age int; v_gender text;
begin
  if v_uid is null then return null; end if;
  if p_total_ms is null or p_total_ms < 300000 or p_total_ms > 10800000 then
    return jsonb_build_object('error', 'bad_total_ms');
  end if;
  select case when birth_year is null then null
              else extract(year from app_today())::int - birth_year end,
         case when gender in ('male','female','other') then gender end
    into v_age, v_gender from profiles where id = v_uid;

  insert into pft_results
    (user_id, tested_on, total_ms, run_ms, burpee_ms, lunge_ms, row_ms,
     pushup_ms, wallball_ms, age, gender, scaled, location)
  values (v_uid, coalesce(p_tested_on, app_today()), p_total_ms,
          p_run_ms, p_burpee_ms, p_lunge_ms, p_row_ms, p_pushup_ms, p_wallball_ms,
          v_age, v_gender, coalesce(p_scaled, false),
          nullif(btrim(coalesce(p_location, '')), ''))
  returning id into v_id;

  return (select jsonb_build_object('ok', true, 'id', f.id, 'total_ms', f.total_ms,
            'badge', f.badge, 'tested_on', f.tested_on)
          from pft_results f where f.id = v_id);
exception when others then
  return jsonb_build_object('error', sqlerrm);
end;
$$;

grant execute on function
  public.mcp_event_attendance(text, text, uuid),
  public.mcp_check_in(text, text, uuid, uuid, boolean),
  public.mcp_set_meetup_flags(text, text, uuid, boolean, boolean, boolean),
  public.mcp_crew_tiers(text, text),
  public.mcp_set_member_tier(text, text, uuid, text),
  public.mcp_crew_unpaid(text, text),
  public.mcp_sync_dues(text, text, text, text),
  public.mcp_waive_dues(text, text, uuid, text),
  public.mcp_crew_stats(text, text),
  public.mcp_list_pft(text, int),
  public.mcp_add_pft(text, int, date, int, int, int, int, int, int, boolean, text)
to anon, authenticated;

-- 가드: 잘못된 토큰은 어떤 도구에서도 데이터를 내보내면 안 되고,
--       정상 토큰은 동작해야 한다.
do $$
declare v_tok text; v_slug text := 'loop8'; j jsonb;
begin
  select mcp_token into v_tok from public.profiles
   where id = '9321eb2e-eae7-4341-bda2-79a20f869760';
  if v_tok is null then return; end if;

  if public.mcp_crew_unpaid('bogus-token', v_slug) is not null
     or public.mcp_crew_stats('bogus-token', v_slug) is not null
     or public.mcp_crew_tiers('bogus-token', v_slug) is not null
     or public.mcp_list_pft('bogus-token', 5) is not null then
    raise exception '가드: 잘못된 토큰에 데이터가 나갔습니다';
  end if;

  j := public.mcp_crew_tiers(v_tok, v_slug);
  if jsonb_array_length(j) = 0 then raise exception '가드: 등급 목록이 비었습니다'; end if;
  j := public.mcp_crew_stats(v_tok, v_slug);
  if (j->>'members')::int = 0 then raise exception '가드: 통계가 비었습니다'; end if;
end $$;
