-- ============================================================
-- Roxlogy — MCP 운영진 도구 (쓰기)
--
-- 크루 운영진(owner/coach)이 AI 를 통해 수행하는 관리 작업:
-- 회계 기록, 모임 등록, 공지 작성, 가입 대기 확인·승인.
-- 모든 함수가 토큰→사용자 확인 후 해당 크루의 운영진 여부를
-- SQL 안에서 검증한다 — 아니면 null 반환(쓰기 없음).
-- ============================================================

-- 토큰 사용자가 운영진인 크루 id (아니면 null)
create or replace function public.mcp_staff_crew(p_token text, p_slug text)
returns uuid
language sql stable security definer set search_path to 'public' as $$
  select c.id from crews c
  join crew_members m on m.crew_id = c.id
    and m.user_id = mcp_uid(p_token)
    and m.status = 'active' and m.role in ('owner', 'coach')
  where c.slug = p_slug and c.status = 'active';
$$;

-- ---------- 회계 기록 (수입/지출)
create or replace function public.mcp_add_ledger(
  p_token text, p_slug text, p_kind text, p_amount int, p_title text,
  p_date date default current_date, p_memo text default null
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  v_id uuid;
begin
  if v_crew is null then return null; end if;
  if p_kind not in ('income', 'expense') or p_amount is null or p_amount <= 0
     or p_title is null or length(trim(p_title)) = 0 then
    return jsonb_build_object('error', 'invalid_input');
  end if;
  insert into crew_ledger (crew_id, entry_date, kind, amount, title, memo, created_by)
  values (v_crew, coalesce(p_date, current_date), p_kind, p_amount,
          left(trim(p_title), 120), nullif(left(trim(coalesce(p_memo, '')), 500), ''),
          mcp_uid(p_token))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'entry_id', v_id,
    'date', coalesce(p_date, current_date), 'kind', p_kind,
    'amount', p_amount, 'title', left(trim(p_title), 120));
end;
$$;

-- ---------- 크루 모임 등록
create or replace function public.mcp_add_meetup(
  p_token text, p_slug text, p_title text, p_starts_at timestamptz,
  p_location text default null, p_description text default null,
  p_kind text default 'social'
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  v_id uuid;
  v_kind text := case when p_kind in ('wod','race_sim','run','strength','social','race')
                      then p_kind else 'social' end;
begin
  if v_crew is null then return null; end if;
  if p_title is null or length(trim(p_title)) = 0 or p_starts_at is null then
    return jsonb_build_object('error', 'invalid_input');
  end if;
  insert into crew_events (crew_id, title, description, kind, starts_at, location, created_by)
  values (v_crew, left(trim(p_title), 120), nullif(trim(coalesce(p_description, '')), ''),
          v_kind, p_starts_at, nullif(trim(coalesce(p_location, '')), ''), mcp_uid(p_token))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'event_id', v_id,
    'title', left(trim(p_title), 120), 'starts_at', p_starts_at, 'kind', v_kind);
end;
$$;

-- ---------- 공지 작성 (게시판 notice 카테고리)
create or replace function public.mcp_post_notice(
  p_token text, p_slug text, p_title text, p_body text,
  p_pinned boolean default false
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  v_id uuid;
begin
  if v_crew is null then return null; end if;
  if p_title is null or length(trim(p_title)) = 0
     or p_body is null or length(trim(p_body)) = 0 then
    return jsonb_build_object('error', 'invalid_input');
  end if;
  insert into crew_posts (crew_id, author_id, category, title, body, pinned)
  values (v_crew, mcp_uid(p_token), 'notice',
          left(trim(p_title), 150), left(p_body, 8000), coalesce(p_pinned, false))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'post_id', v_id,
    'title', left(trim(p_title), 150), 'pinned', coalesce(p_pinned, false));
end;
$$;

-- ---------- 가입 대기 멤버 목록
create or replace function public.mcp_pending_members(p_token text, p_slug text)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', m.user_id,
      'display_name', p.display_name,
      'requested_at', m.joined_at) order by m.joined_at), '[]'::jsonb)
  from crew_members m
  join profiles p on p.id = m.user_id
  where m.crew_id = mcp_staff_crew(p_token, p_slug) and m.status = 'pending';
$$;

-- ---------- 가입 승인
create or replace function public.mcp_approve_member(
  p_token text, p_slug text, p_user_id uuid
)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_crew uuid := mcp_staff_crew(p_token, p_slug);
  v_name text;
begin
  if v_crew is null then return null; end if;
  update crew_members set status = 'active'
  where crew_id = v_crew and user_id = p_user_id and status = 'pending';
  if not found then
    return jsonb_build_object('error', 'no_pending_request_for_user');
  end if;
  select display_name into v_name from profiles where id = p_user_id;
  return jsonb_build_object('ok', true, 'approved', v_name);
end;
$$;

grant execute on function
  public.mcp_add_ledger(text, text, text, int, text, date, text),
  public.mcp_add_meetup(text, text, text, timestamptz, text, text, text),
  public.mcp_post_notice(text, text, text, text, boolean),
  public.mcp_pending_members(text, text),
  public.mcp_approve_member(text, text, uuid)
to anon, authenticated;
