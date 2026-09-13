-- ============================================================
-- Roxlogy — 크루 회원 변경 이력 (등급·권한·상태)
--
-- 지금까지 crew_members 는 (crew_id, user_id, role, status, joined_at, tier_id) 뿐이라
-- 등급을 바꾸면 이전 값이 흔적 없이 사라졌다. 등급이 곧 요금표(월회비·회차비)이고
-- generate_monthly_charges 가 **현재** 등급을 보고 미납 청구를 다시 만들거나 회수하므로,
-- 월 중간에 등급을 옮기면 청구가 따라 움직이는데 나중에 그 근거를 댈 수가 없었다
-- (2026-09-13 운영 피드백).
--
-- RPC(set_crew_tier)에 기록을 넣지 않고 **테이블 트리거**로 잡는다. tier_id 를 쓰는
-- 경로가 하나가 아니기 때문이다: set_crew_tier(웹) · mcp_set_member_tier(MCP) ·
-- crew_member_tier_sync(가입·승인 시 기본 등급 자동 부여) · 마이그레이션의 직접 update.
-- RPC 만 고치면 뒤의 셋을 놓친다.
--
-- 한 번의 UPDATE 가 한 줄이다. 등급을 바꾸면 crew_member_tier_sync 가 role 도 같이
-- 바꾸는데, 그걸 두 줄로 쪼개면 화면에서 같은 사건이 두 번 일어난 것처럼 보인다.
--
-- 소급은 불가능하다 — 지금까지의 변경은 어디에도 없다. 이 트리거를 다는 시점부터 쌓인다.
-- ============================================================

create table if not exists public.crew_member_changes (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crews(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  changed_at timestamptz not null default now(),
  -- 누가 바꿨나. 자동 부여(트리거)·크론이면 null
  changed_by uuid references public.profiles(id) on delete set null,
  -- 'join' = 가입·승인으로 행이 생긴 첫 줄, 'change' = 그 뒤의 변경
  kind text not null check (kind in ('join', 'change')),
  old_tier uuid references public.crew_member_tiers(id) on delete set null,
  new_tier uuid references public.crew_member_tiers(id) on delete set null,
  -- 이름 스냅샷 — delete_crew_tier 는 쓰는 사람이 없으면 실삭제를 한다. 그러면 위 FK 가
  -- set null 이 되어 이력이 "→ (알 수 없음)" 이 된다.
  old_tier_name text,
  new_tier_name text,
  old_role text,
  new_role text,
  old_status text,
  new_status text
);

comment on table public.crew_member_changes is
  '크루 회원의 등급·권한·상태 변경 이력. crew_members 트리거가 채운다(클라이언트 쓰기 없음).';

create index if not exists crew_member_changes_crew_idx
  on public.crew_member_changes(crew_id, changed_at desc);
create index if not exists crew_member_changes_member_idx
  on public.crew_member_changes(crew_id, user_id, changed_at desc);

alter table public.crew_member_changes enable row level security;

-- 조회는 그 크루 운영진 · 본인 · 관리자. 쓰기 정책은 두지 않는다 — 트리거만 넣는다
-- (SECURITY DEFINER 함수가 소유자 권한으로 돌아 RLS 를 지나간다).
drop policy if exists crew_member_changes_select on public.crew_member_changes;
create policy crew_member_changes_select on public.crew_member_changes
  for select using (
    user_id = (select auth.uid())
    or (select is_crew_staff(crew_id))
    or (select is_admin())
  );

-- 기록 트리거 --------------------------------------------------------------
create or replace function public.crew_member_log_change() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare
  v_old_tier uuid; v_old_role text; v_old_status text; v_kind text;
begin
  if tg_op = 'INSERT' then
    v_kind := 'join';
  else
    -- 이 셋이 그대로면 남길 것이 없다(joined_at 등 다른 컬럼 수정)
    if new.tier_id is not distinct from old.tier_id
       and new.role is not distinct from old.role
       and new.status is not distinct from old.status then
      return null;
    end if;
    v_kind := 'change';
    v_old_tier := old.tier_id;
    v_old_role := old.role;
    v_old_status := old.status;
  end if;

  insert into crew_member_changes(
    crew_id, user_id, changed_by, kind,
    old_tier, new_tier, old_tier_name, new_tier_name,
    old_role, new_role, old_status, new_status)
  values (
    new.crew_id, new.user_id, auth.uid(), v_kind,
    v_old_tier, new.tier_id,
    (select name from crew_member_tiers where id = v_old_tier),
    (select name from crew_member_tiers where id = new.tier_id),
    v_old_role, new.role, v_old_status, new.status);

  return null; -- after 트리거라 반환값은 쓰이지 않는다
end; $$;

-- AFTER 라 BEFORE 트리거(crew_members_tier_sync)가 기본 등급·role 을 다 고친 뒤의
-- 최종 값이 기록된다
drop trigger if exists crew_members_log_change on public.crew_members;
create trigger crew_members_log_change
  after insert or update on public.crew_members
  for each row execute function public.crew_member_log_change();

-- 조회 RPC -----------------------------------------------------------------
-- p_user 를 주면 그 회원만. 운영진이 아니면 본인 것만 볼 수 있다.
create or replace function public.crew_member_changes_list(
  p_slug text, p_user uuid default null, p_limit int default 50
) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_crew uuid; v_uid uuid := auth.uid(); v_staff boolean;
begin
  if v_uid is null then return jsonb_build_object('error', 'auth_required'); end if;
  select id into v_crew from crews where slug = p_slug;
  if v_crew is null then return jsonb_build_object('error', 'crew_not_found'); end if;

  v_staff := is_crew_staff(v_crew) or is_admin();
  if not v_staff and p_user is distinct from v_uid then
    return jsonb_build_object('error', 'not_allowed');
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.changed_at desc)
    from (
      select c.id, c.user_id, c.changed_at, c.kind,
             coalesce(nullif(p.display_name, ''), 'Athlete') as name,
             c.changed_by,
             coalesce(nullif(b.display_name, ''), '') as by_name,
             c.old_tier_name, c.new_tier_name,
             c.old_role, c.new_role, c.old_status, c.new_status
        from crew_member_changes c
        join profiles p on p.id = c.user_id
        left join profiles b on b.id = c.changed_by
       where c.crew_id = v_crew
         and (p_user is null or c.user_id = p_user)
       order by c.changed_at desc
       limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) x
  ), '[]'::jsonb);
end; $$;

grant execute on function public.crew_member_changes_list(text, uuid, int) to authenticated;

-- 가드 ----------------------------------------------------------------------
do $$
declare
  v_crew uuid; v_owner uuid; v_target uuid; v_tier uuid; v_old uuid;
  v_n int; v_row record; v_res jsonb;
begin
  -- 리더가 있고 리더가 아닌 활동 회원이 한 명 이상인 크루
  select o.crew_id, o.user_id into v_crew, v_owner
    from crew_members o
   where o.role = 'owner'
     and exists (select 1 from crew_members m
                  where m.crew_id = o.crew_id and m.role <> 'owner' and m.status = 'active')
   limit 1;
  if v_crew is null then raise notice '가드 건너뜀: 대상 크루 없음'; return; end if;

  select m.user_id, m.tier_id into v_target, v_old
    from crew_members m
   where m.crew_id = v_crew and m.role <> 'owner' and m.status = 'active' limit 1;

  select id into v_tier from crew_member_tiers
   where crew_id = v_crew and archived_at is null and id is distinct from v_old limit 1;
  if v_tier is null then raise notice '가드 건너뜀: 옮길 등급이 없음'; return; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  -- 등급을 바꾸면 한 줄이 남고, 누가 바꿨는지도 남는다
  perform set_config('rox.crew_role_bypass', '1', true);
  update crew_members set tier_id = v_tier where crew_id = v_crew and user_id = v_target;

  select count(*) into v_n from crew_member_changes
   where crew_id = v_crew and user_id = v_target and kind = 'change';
  if v_n <> 1 then raise exception '가드: 변경 이력이 1줄이 아니다 (%)', v_n; end if;

  select * into v_row from crew_member_changes
   where crew_id = v_crew and user_id = v_target order by changed_at desc limit 1;
  if v_row.new_tier is distinct from v_tier then
    raise exception '가드: 새 등급이 기록되지 않았다';
  end if;
  if v_row.changed_by is distinct from v_owner then
    raise exception '가드: 바꾼 사람이 기록되지 않았다 (%)', v_row.changed_by;
  end if;
  if v_row.new_tier_name is null then
    raise exception '가드: 등급 이름 스냅샷이 비어 있다';
  end if;

  -- 같은 값으로 다시 쓰면 줄이 늘지 않는다
  update crew_members set tier_id = v_tier where crew_id = v_crew and user_id = v_target;
  select count(*) into v_n from crew_member_changes
   where crew_id = v_crew and user_id = v_target and kind = 'change';
  if v_n <> 1 then raise exception '가드: 변화가 없는데 이력이 늘었다 (%)', v_n; end if;

  -- 운영진은 크루 전체를 본다
  select crew_member_changes_list((select slug from crews where id = v_crew), null, 50) into v_res;
  if jsonb_typeof(v_res) <> 'array' or jsonb_array_length(v_res) = 0 then
    raise exception '가드: 운영진이 이력을 못 읽는다 (%)', v_res;
  end if;

  -- 남의 이력은 못 본다
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  select crew_member_changes_list((select slug from crews where id = v_crew), v_target, 50) into v_res;
  if v_res->>'error' is distinct from 'not_allowed' then
    raise exception '가드: 남의 이력이 보인다 (%)', v_res;
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise exception '__guard_rollback__';
exception
  when others then
    if sqlerrm = '__guard_rollback__' then return; end if;
    raise;
end $$;
