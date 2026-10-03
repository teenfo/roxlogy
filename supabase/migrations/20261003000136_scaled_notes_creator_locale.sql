-- ============================================================
-- Roxlogy — scaled 세션 메모를 "레이스를 만든 시점의 운영자 언어"로 (2026-10-03, 사용자 지정)
--
-- 135 는 세션 메모의 scaled 기준 한 줄을 한국어로만 썼다. 이제 "레이스를 만든 시점"의 운영자 언어를
-- 따른다(사용자 지정). 만든 뒤 운영자가 언어를 바꿔도 메모는 흔들리지 않게 레이스에 저장해 둔다.
--   pft_races.locale — 만들 때 BEFORE INSERT 트리거가 만든 사람 profiles.locale(없으면 ko)로 채운다.
--   기존 레이스는 만든 사람의 지금 언어로 한 번 채운다(그때 값은 남아 있지 않다).
-- 종목 이름·단위·머리말이 모두 그 언어다.
--   _pft_races_set_locale() 트리거 — 만들 때 언어 저장
--   _pft_scaled_spec_text_l(spec, locale) — 언어별 한 줄 요약(내부)
--   _pft_scaled_spec_text(spec)            — 135 와 같은 이름, ko 로 위임(호환)
--   _race_sim_notes(entry)                 — 만든 시점 언어로
--   pft_race_set_scaled_spec               — 응답 summary 도 만든 시점 언어로
-- 이미 만들어진 scaled 시뮬 세션 메모도 한 번 다시 쓴다.
-- 재정의(인자·반환 그대로) + 신설 — 배포 순서 무관.
-- 되돌리기: 135 의 _pft_scaled_spec_text·_race_sim_notes·pft_race_set_scaled_spec 재적용,
--           트리거·locale 컬럼 제거.
-- ============================================================

alter table public.pft_races add column if not exists locale text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pft_races_locale_check') then
    alter table public.pft_races add constraint pft_races_locale_check
      check (locale is null or locale in ('ko', 'en', 'es'));
  end if;
end $$;

create or replace function public._pft_races_set_locale()
returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.locale is null then
    new.locale := coalesce((select p.locale from profiles p where p.id = new.created_by), 'ko');
  end if;
  return new;
end; $$;
revoke all on function public._pft_races_set_locale() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'pft_races_set_locale'
                   and tgrelid = 'public.pft_races'::regclass) then
    create trigger pft_races_set_locale before insert on public.pft_races
      for each row execute function public._pft_races_set_locale();
  end if;
end $$;

-- 기존 레이스: 만든 사람의 지금 언어로 한 번 채운다
update pft_races r set locale = coalesce((select p.locale from profiles p where p.id = r.created_by), 'ko')
 where r.locale is null;

create or replace function public._pft_scaled_spec_text_l(p_spec jsonb, p_locale text)
returns text
language sql immutable set search_path to 'public' as $$
  select string_agg(
           n.name
           || coalesce(' ' || (p_spec->n.key->>'amount')
                       || case when n.key = 'wallballs'
                               then case l.loc when 'en' then ' reps' when 'es' then ' rep.' else '회' end
                               else 'm' end, '')
           || coalesce(' ' || (p_spec->n.key->>'weight') || 'kg', ''),
           ' · ' order by n.ord)
    from (select case when p_locale in ('ko', 'en', 'es') then p_locale else 'ko' end as loc) l
    cross join lateral (values
      (1, 'ski',       case l.loc when 'ko' then '스키에르그'     else 'SkiErg' end),
      (2, 'sledpush',  case l.loc when 'ko' then '슬레드 푸시'    else 'Sled Push' end),
      (3, 'sledpull',  case l.loc when 'ko' then '슬레드 풀'      else 'Sled Pull' end),
      (4, 'burpee',    case l.loc when 'ko' then '버피 브로드점프' else 'Burpee Broad Jump' end),
      (5, 'row',       case l.loc when 'ko' then '로잉' when 'es' then 'Remo' else 'Rowing' end),
      (6, 'farmers',   case l.loc when 'ko' then '파머스 캐리'    else 'Farmers Carry' end),
      (7, 'lunges',    case l.loc when 'ko' then '샌드백 런지' when 'es' then 'Zancadas con saco' else 'Sandbag Lunges' end),
      (8, 'wallballs', case l.loc when 'ko' then '월볼'          else 'Wall Balls' end)
    ) n(ord, key, name)
   where p_spec ? n.key;
$$;
revoke all on function public._pft_scaled_spec_text_l(jsonb, text) from public, anon, authenticated;

create or replace function public._pft_scaled_spec_text(p_spec jsonb)
returns text
language sql immutable set search_path to 'public' as $$
  select _pft_scaled_spec_text_l(p_spec, 'ko');
$$;
revoke all on function public._pft_scaled_spec_text(jsonb) from public, anon, authenticated;

-- 레이스를 만든 시점의 언어 (없으면 ko)
create or replace function public._pft_race_locale(p_race uuid)
returns text
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select r.locale from pft_races r where r.id = p_race), 'ko');
$$;
revoke all on function public._pft_race_locale(uuid) from public, anon, authenticated;

-- 세션 메모: 레이스 제목 + (scaled 면) 머리말과 기준 한 줄 — 만든 시점 언어로
create or replace function public._race_sim_notes(p_entry uuid)
returns text
language sql stable security definer set search_path to 'public' as $$
  select left(r.title, 200)
         || case when e.scaled then
              E'\n'
              || case l.loc when 'en' then 'Scaled' when 'es' then 'Adaptado (scaled)' else '수정(scaled)' end
              || coalesce(': ' || _pft_scaled_spec_text_l(r.scaled_spec, l.loc), '')
            else '' end
    from pft_race_entries e
    join pft_races r on r.id = e.race_id
    cross join lateral (select _pft_race_locale(r.id) as loc) l
   where e.id = p_entry;
$$;
revoke all on function public._race_sim_notes(uuid) from public, anon, authenticated;

create or replace function public.pft_race_set_scaled_spec(p_race uuid, p_spec jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r record; v_spec jsonb;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  select * into r from pft_races where id = p_race;
  if r.id is null then return jsonb_build_object('error', 'race_not_found'); end if;
  if not pft_race_can_manage(p_race) then return jsonb_build_object('error', 'not_allowed'); end if;
  if r.format <> 'hyrox_sim' then return jsonb_build_object('error', 'invalid_format'); end if;
  begin
    v_spec := _pft_scaled_spec_clean(p_spec);
  exception when raise_exception then
    return jsonb_build_object('error', 'invalid_scaled_spec');
  end;
  update pft_races set scaled_spec = v_spec where id = p_race;
  update sessions s set notes = _race_sim_notes(e.id)
    from pft_race_entries e
   where e.race_id = p_race and e.scaled and e.session_id = s.id;
  return jsonb_build_object('ok', true, 'scaled_spec', v_spec,
                            'summary', _pft_scaled_spec_text_l(coalesce(v_spec, '{}'::jsonb), _pft_race_locale(p_race)));
end; $$;
grant execute on function public.pft_race_set_scaled_spec(uuid, jsonb) to authenticated;

-- 이미 만들어진 scaled 시뮬 세션 메모를 새 규칙으로 한 번 다시 쓴다
update sessions s set notes = _race_sim_notes(e.id)
  from pft_race_entries e join pft_races r on r.id = e.race_id
 where r.format = 'hyrox_sim' and e.scaled and e.session_id = s.id;

-- ---------- 가드 -----------------------------------------------------------------
do $$
declare v_spec jsonb := '{"sledpush":{"amount":25},"wallballs":{"amount":75,"weight":4}}';
begin
  if has_function_privilege('authenticated', 'public._pft_scaled_spec_text_l(jsonb, text)', 'execute')
     or has_function_privilege('authenticated', 'public._pft_race_locale(uuid)', 'execute') then
    raise exception '가드: 내부 함수가 열려 있습니다';
  end if;
  if _pft_scaled_spec_text_l(v_spec, 'ko') <> '슬레드 푸시 25m · 월볼 75회 4kg' then
    raise exception '가드: ko %', _pft_scaled_spec_text_l(v_spec, 'ko');
  end if;
  if _pft_scaled_spec_text_l(v_spec, 'en') <> 'Sled Push 25m · Wall Balls 75 reps 4kg' then
    raise exception '가드: en %', _pft_scaled_spec_text_l(v_spec, 'en');
  end if;
  if _pft_scaled_spec_text_l(v_spec, 'es') <> 'Sled Push 25m · Wall Balls 75 rep. 4kg' then
    raise exception '가드: es %', _pft_scaled_spec_text_l(v_spec, 'es');
  end if;
  if _pft_scaled_spec_text_l(v_spec, null) <> _pft_scaled_spec_text(v_spec) then
    raise exception '가드: 언어 없음은 ko';
  end if;
end $$;

-- 만든 시점 언어가 메모에 반영되는지 — 운영자 locale 을 en 으로 바꿔 레이스를 만들고, ko 로 되돌린 뒤 완주해 보고 되감는다
do $$
declare v_crew uuid; v_slug text; v_staff uuid; v_m1 uuid; j jsonb; v_race uuid; v_entry uuid; v_sess uuid; i int;
begin
  select m.crew_id, c.slug, m.user_id into v_crew, v_slug, v_staff
    from crew_members m join crews c on c.id = m.crew_id and c.status = 'active'
    join profiles pr on pr.id = m.user_id and not pr.disabled
   where m.status = 'active' and m.role in ('owner', 'coach')
     and (select count(*) from crew_members x where x.crew_id = m.crew_id and x.status = 'active') >= 2
   limit 1;
  if v_crew is null then raise notice '가드 건너뜀: 크루 없음'; return; end if;
  select m.user_id into v_m1 from crew_members m join profiles p on p.id = m.user_id and not p.disabled
   where m.crew_id = v_crew and m.status = 'active' and m.user_id <> v_staff
     and m.role not in ('owner', 'coach') limit 1;
  if v_m1 is null then raise notice '가드 건너뜀: 일반 크루원 없음'; return; end if;

  begin
    perform set_config('rox.profile_bypass', '1', true);
    update profiles set locale = 'en' where id = v_staff;
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text, 'role', 'authenticated')::text, true);
    j := pft_race_create('Guard scaled', v_slug, false, 'hyrox_sim', 16);
    v_race := (j->>'id')::uuid;
    j := pft_race_set_scaled_spec(v_race, '{"sledpush":{"amount":25}}');
    if j->>'summary' <> 'Sled Push 25m' then raise exception '가드: 응답 요약 언어 %', j; end if;
    j := pft_race_staff_add(v_race, v_m1);
    v_entry := (j->>'entry_id')::uuid;
    j := pft_race_set_scaled(v_race, v_entry, true);
    -- 만든 뒤 운영자가 언어를 바꿔도 메모는 만든 시점(en)을 따른다
    update profiles set locale = 'ko' where id = v_staff;
    j := pft_race_set_wave(v_race, array[v_entry], 1::smallint);
    j := pft_race_staff_start(v_race, array[v_entry]);
    update pft_race_entries set started_at = now() - interval '3 hours' where id = v_entry;
    for i in 1..16 loop
      j := pft_race_staff_split(v_race, v_entry, i * 600000);
    end loop;
    select session_id into v_sess from pft_race_entries where id = v_entry;
    if (select notes from sessions where id = v_sess) <> E'Guard scaled\nScaled: Sled Push 25m' then
      raise exception '가드: 세션 메모 언어 %', (select notes from sessions where id = v_sess);
    end if;
    perform set_config('request.jwt.claims', null, true);
    perform set_config('rox.profile_bypass', '', true);
    raise exception 'guard_ok';
  exception when raise_exception then
    perform set_config('request.jwt.claims', null, true);
    perform set_config('rox.profile_bypass', '', true);
    if sqlerrm <> 'guard_ok' then raise; end if;
  end;
end $$;
