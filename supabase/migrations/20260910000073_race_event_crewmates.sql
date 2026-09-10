-- 같은 대회에 나가는 크루원.
--
-- 대회 페이지에서 "누가 같이 나가나"는 크루 화면에서 제일 궁금한 정보인데
-- 지금까지 볼 곳이 없었다. race_plans 를 대회로 묶어 보여준다.
--
-- 공개 범위: **나와 같은 크루에 함께 속한 사람만.** 대회 페이지는 비로그인도
-- 열리는 공개 화면이라, 출전 계획(실명 + 디비전)을 아무에게나 내보내면 안 된다.
-- 로그인하지 않았으면 아무것도 내려가지 않는다.
create or replace function public.race_event_crewmates(p_event uuid)
returns table(user_id uuid, display_name text, crew_slug text, crew_name text,
              division text, race_date date)
language sql
stable
security definer
set search_path = public
as $$
  select q.user_id, q.display_name, q.crew_slug, q.crew_name,
         q.division, q.race_date
    from (
      -- 여러 크루를 함께 쓰면 한 사람이 여러 번 나온다 — 이름순 첫 크루만
      select distinct on (rp.user_id)
             rp.user_id,
             coalesce(pr.display_name, 'Athlete') as display_name,
             c.slug as crew_slug,
             c.name as crew_name,
             nullif(rp.division, '') as division,
             rp.race_date
        from race_plans rp
        join profiles pr on pr.id = rp.user_id
        join crew_members m
          on m.user_id = rp.user_id and m.status = 'active'
        join crews c on c.id = m.crew_id and c.status = 'active'
       where rp.race_event_id = p_event
         and (select auth.uid()) is not null
         and exists (
           select 1 from crew_members me
            where me.crew_id = c.id
              and me.user_id = (select auth.uid())
              and me.status = 'active')
       order by rp.user_id, c.name
    ) q
   order by q.display_name;
$$;

grant execute on function public.race_event_crewmates(uuid) to anon, authenticated;

-- 검증 — 비로그인은 0건, 같은 크루원에게는 보이고, 남남에게는 안 보인다
do $$
declare
  v_event uuid;
  v_me uuid;
  v_other uuid;
  v_n int;
begin
  select rp.race_event_id into v_event
    from race_plans rp
    join crew_members m on m.user_id = rp.user_id and m.status = 'active'
   where rp.race_event_id is not null
   group by rp.race_event_id
   order by count(*) desc
   limit 1;
  if v_event is null then
    raise notice 'no linked race plans — skipping guard';
    return;
  end if;

  -- 이 대회 계획을 가진 크루원 하나
  select rp.user_id into v_me
    from race_plans rp
    join crew_members m on m.user_id = rp.user_id and m.status = 'active'
   where rp.race_event_id = v_event
   limit 1;

  -- 익명
  perform set_config('request.jwt.claims', null, true);
  select count(*) into v_n from race_event_crewmates(v_event);
  if v_n <> 0 then
    raise exception 'anon sees % crewmates', v_n;
  end if;

  -- 본인(크루원)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_me::text, 'role', 'authenticated')::text, true);
  select count(*) into v_n from race_event_crewmates(v_event);
  if v_n = 0 then
    raise exception 'crew member sees no crewmates';
  end if;

  -- 같은 크루가 아닌 사람 — 있으면 0건이어야 한다
  select p.id into v_other
    from profiles p
   where p.id <> v_me
     and not exists (
       select 1 from crew_members a
        join crew_members b on b.crew_id = a.crew_id and b.status = 'active'
       where a.user_id = p.id and a.status = 'active' and b.user_id = v_me)
   limit 1;
  if v_other is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
    select count(*) into v_n from race_event_crewmates(v_event);
    if v_n <> 0 then
      raise exception 'outsider sees % crewmates', v_n;
    end if;
  end if;

  perform set_config('request.jwt.claims', null, true);
end $$;
