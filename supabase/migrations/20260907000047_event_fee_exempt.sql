-- ============================================================
-- Roxlogy — 무료 행사 (회차비를 받지 않는 모임)
--
-- 회차비는 모임 출석 체크를 근거로 만들어진다. 그런데 모임 중에는 회차비를
-- 받지 않는 것도 있다(공개 체험, 대회 응원, 봉사, 신입 환영 등). 지금은
-- 출석을 찍는 순간 무조건 청구가 생겨서 운영진이 매번 하나씩 면제해야 했다.
--
-- crew_events.fee_exempt 로 모임 자체에 표시한다:
--   · 출석 체크는 그대로 남는다 (출석 통계·누적 출석 횟수에는 포함)
--   · 청구만 만들지 않는다 — 체크 시점에도, 대사(reconcile)에서도
--   · 무료로 바꾸는 순간 그 모임의 미납 청구를 회수한다
--   · 다시 유료로 되돌리면 그 달을 대사해 출석분 청구를 되살린다
-- 이미 확정된 청구는 어느 쪽으로도 건드리지 않는다 (회계 기록과 묶여 있다).
-- ============================================================

alter table public.crew_events
  add column if not exists fee_exempt boolean not null default false;

create or replace function public.crew_event_check_in(
  p_event uuid, p_user uuid, p_present boolean
) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_crew uuid; v_title text; v_starts timestamptz; v_free boolean;
  v_fee int; v_tier uuid; v_period text;
begin
  select crew_id, title, starts_at, fee_exempt
    into v_crew, v_title, v_starts, v_free
    from crew_events where id = p_event and cancelled_at is null;
  if v_crew is null then raise exception 'event_not_found'; end if;
  if not ((select is_crew_staff(v_crew)) or (select is_admin())) then
    raise exception 'attend_not_staff';
  end if;
  if not exists (
    select 1 from crew_members m
    where m.crew_id = v_crew and m.user_id = p_user and m.status = 'active'
  ) then
    raise exception 'attend_not_member';
  end if;

  if p_present then
    insert into crew_event_rsvps(event_id, user_id, status, checked_in_at)
    values (p_event, p_user, 'going', now())
    on conflict (event_id, user_id) do update set checked_in_at = now();

    -- 무료 행사는 출석만 남기고 청구하지 않는다
    if not v_free then
      select t.session_fee, t.id into v_fee, v_tier
        from crew_members m join crew_member_tiers t on t.id = m.tier_id
       where m.crew_id = v_crew and m.user_id = p_user;
      if v_fee is not null then
        v_period := to_char(v_starts at time zone 'Asia/Seoul', 'YYYY-MM');
        insert into crew_dues_charges
          (crew_id, user_id, kind, label, amount, period, event_id, tier_id, created_by)
        values (v_crew, p_user, 'session', left(v_title, 120), v_fee, v_period,
                p_event, v_tier, auth.uid())
        on conflict (crew_id, user_id, event_id) where kind = 'session' do nothing;
      end if;
    end if;
  else
    update crew_event_rsvps set checked_in_at = null
     where event_id = p_event and user_id = p_user;
    delete from crew_dues_charges
     where event_id = p_event and user_id = p_user
       and kind = 'session' and status = 'pending';
  end if;
end;
$$;

create or replace function public.generate_session_charges(p_crew uuid, p_period text)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_created int := 0; v_updated int := 0; v_removed int := 0; v_locked int := 0;
begin
  if not ((select is_crew_staff(p_crew)) or (select is_admin())) then
    raise exception 'dues_not_staff';
  end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'dues_bad_period'; end if;

  insert into crew_dues_charges
    (crew_id, user_id, kind, label, amount, period, event_id, tier_id, created_by)
  select e.crew_id, r.user_id, 'session', left(e.title, 120), t.session_fee,
         p_period, e.id, t.id, auth.uid()
  from crew_events e
  join crew_event_rsvps r on r.event_id = e.id and r.checked_in_at is not null
  join crew_members m on m.crew_id = e.crew_id and m.user_id = r.user_id and m.status = 'active'
  join crew_member_tiers t on t.id = m.tier_id
  where e.crew_id = p_crew and e.cancelled_at is null and not e.fee_exempt
    and to_char(e.starts_at at time zone 'Asia/Seoul', 'YYYY-MM') = p_period
    and t.session_fee is not null
  on conflict (crew_id, user_id, event_id) where kind = 'session' do nothing;
  get diagnostics v_created = row_count;

  update crew_dues_charges ch
     set amount = t.session_fee, tier_id = t.id, label = left(e.title, 120)
    from crew_events e, crew_members m, crew_member_tiers t
   where ch.crew_id = p_crew and ch.period = p_period and ch.kind = 'session'
     and ch.status = 'pending'
     and e.id = ch.event_id and e.cancelled_at is null and not e.fee_exempt
     and m.crew_id = ch.crew_id and m.user_id = ch.user_id and m.status = 'active'
     and t.id = m.tier_id and t.session_fee is not null
     and (ch.amount is distinct from t.session_fee
          or ch.tier_id is distinct from t.id
          or ch.label is distinct from left(e.title, 120));
  get diagnostics v_updated = row_count;

  delete from crew_dues_charges ch
   where ch.crew_id = p_crew and ch.period = p_period and ch.kind = 'session'
     and ch.status = 'pending'
     and not exists (
       select 1 from crew_events e
       join crew_event_rsvps r on r.event_id = e.id and r.user_id = ch.user_id
                              and r.checked_in_at is not null
       join crew_members m on m.crew_id = e.crew_id and m.user_id = ch.user_id
                          and m.status = 'active'
       join crew_member_tiers t on t.id = m.tier_id and t.session_fee is not null
       where e.id = ch.event_id and e.cancelled_at is null and not e.fee_exempt);
  get diagnostics v_removed = row_count;

  select count(*) into v_locked
    from crew_dues_charges ch
    join crew_members m on m.crew_id = ch.crew_id and m.user_id = ch.user_id
    join crew_member_tiers t on t.id = m.tier_id
   where ch.crew_id = p_crew and ch.period = p_period and ch.kind = 'session'
     and ch.status in ('reported', 'confirmed')
     and ch.amount is distinct from t.session_fee;

  return jsonb_build_object('created', v_created, 'updated', v_updated,
                            'removed', v_removed, 'locked', v_locked);
end;
$$;

-- 무료 행사 토글 — 켜면 그 모임의 미납 청구를 즉시 회수하고,
-- 끄면 그 달을 다시 대사해 출석분 청구를 되살린다.
create or replace function public.set_event_fee_exempt(p_event uuid, p_on boolean)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_crew uuid; v_period text; n int := 0;
begin
  select e.crew_id, to_char(e.starts_at at time zone 'Asia/Seoul', 'YYYY-MM')
    into v_crew, v_period
    from crew_events e where e.id = p_event;
  if v_crew is null then raise exception 'event_not_found'; end if;
  if not ((select is_crew_staff(v_crew)) or (select is_admin())) then
    raise exception 'attend_not_staff';
  end if;

  update crew_events set fee_exempt = p_on where id = p_event;

  if p_on then
    delete from crew_dues_charges
     where event_id = p_event and kind = 'session' and status = 'pending';
    get diagnostics n = row_count;
    return jsonb_build_object('fee_exempt', true, 'removed', n);
  end if;
  return jsonb_build_object('fee_exempt', false)
      || public.generate_session_charges(v_crew, v_period);
end;
$$;
grant execute on function public.set_event_fee_exempt(uuid, boolean) to authenticated;

-- 모임 상세에 fee_exempt 노출 (반환형 변경 → 재생성)
drop function if exists public.crew_event_detail(uuid);
create function public.crew_event_detail(p_event uuid)
returns table(
  id uuid, slug text, title text, description text, kind text,
  starts_at timestamptz, ends_at timestamptz, location text, capacity integer,
  going_names text[], maybe_names text[], declined_count bigint,
  my_status text, is_staff boolean,
  comments_allowed boolean, comments jsonb, waitlist_names text[],
  fee_exempt boolean
)
language sql stable security definer set search_path to 'public' as $$
  select e.id, c.slug, e.title, e.description, e.kind,
         e.starts_at, e.ends_at, e.location, e.capacity,
         coalesce((select array_agg(coalesce(pr.display_name, 'Athlete') order by r.created_at)
            from crew_event_rsvps r join profiles pr on pr.id = r.user_id
            where r.event_id = e.id and r.status = 'going'), '{}'),
         coalesce((select array_agg(coalesce(pr.display_name, 'Athlete') order by r.created_at)
            from crew_event_rsvps r join profiles pr on pr.id = r.user_id
            where r.event_id = e.id and r.status = 'maybe'), '{}'),
         (select count(*) from crew_event_rsvps r
            where r.event_id = e.id and r.status = 'declined'),
         (select r.status from crew_event_rsvps r
            where r.event_id = e.id and r.user_id = auth.uid()),
         is_crew_staff(e.crew_id),
         e.comments_allowed,
         coalesce((select jsonb_agg(jsonb_build_object(
              'id', cm.id, 'author_id', cm.author_id,
              'author_name', coalesce(pr2.display_name, 'Athlete'),
              'body', cm.body, 'created_at', cm.created_at)
              order by cm.created_at)
            from crew_event_comments cm
            join profiles pr2 on pr2.id = cm.author_id
            where cm.event_id = e.id and cm.deleted_at is null), '[]'::jsonb),
         coalesce((select array_agg(coalesce(pr.display_name, 'Athlete')
              order by r.queued_at nulls first, r.created_at)
            from crew_event_rsvps r join profiles pr on pr.id = r.user_id
            where r.event_id = e.id and r.status = 'waitlisted'), '{}'),
         e.fee_exempt
  from crew_events e
  join crews c on c.id = e.crew_id
  where e.id = p_event
    and e.cancelled_at is null
    and (c.is_public or is_crew_member(c.id))
    and (not e.members_only or is_crew_full_member(e.crew_id));
$$;
grant execute on function public.crew_event_detail(uuid) to anon, authenticated;
