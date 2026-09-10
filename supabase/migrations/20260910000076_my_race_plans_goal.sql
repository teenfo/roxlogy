-- my_race_plans 에 목표 스플릿을 함께 싣는다. 목록에서 바로 목표를 보여주는데
-- 계획마다 goal_plans 를 또 조회하면 N+1 이 된다.
drop function if exists public.my_race_plans();

create function public.my_race_plans()
returns table(id uuid, title text, race_date date, division text, bib text,
              note text, goal_plan_id uuid, race_event_id uuid,
              role text, my_status text, owner_name text, partners jsonb,
              goal_target_ms bigint, goal_run_ms bigint,
              goal_station_ms bigint, goal_roxzone_ms bigint)
language sql
stable
security definer
set search_path = public
as $$
  select rp.id, rp.title, rp.race_date, rp.division, rp.bib, rp.note,
         rp.goal_plan_id, rp.race_event_id,
         case when rp.user_id = (select auth.uid()) then 'owner' else 'partner' end,
         case when rp.user_id = (select auth.uid()) then null
              else (select pp.status from race_plan_partners pp
                     where pp.plan_id = rp.id
                       and pp.user_id = (select auth.uid())) end,
         coalesce(op.display_name, 'Athlete'),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'user_id', pp.user_id,
                     'name', coalesce(pr.display_name, 'Athlete'),
                     'status', pp.status)
                   order by pp.created_at)
                     from race_plan_partners pp
                     join profiles pr on pr.id = pp.user_id
                    where pp.plan_id = rp.id), '[]'::jsonb),
         g.target_total_ms, g.run_total_ms, g.station_total_ms, g.roxzone_total_ms
    from race_plans rp
    join profiles op on op.id = rp.user_id
    left join goal_plans g on g.id = rp.goal_plan_id
   where (select auth.uid()) is not null
     and (
       rp.user_id = (select auth.uid())
       or exists (select 1 from race_plan_partners pp
                   where pp.plan_id = rp.id
                     and pp.user_id = (select auth.uid())
                     and pp.status in ('pending', 'accepted'))
     )
   order by rp.race_date;
$$;

grant execute on function public.my_race_plans() to anon, authenticated;

-- 계획 하나 상세 — 소유자와 (수락·대기 중인) 파트너만 볼 수 있다
create or replace function public.my_race_plan(p_plan uuid)
returns table(id uuid, title text, race_date date, division text, bib text,
              note text, goal_plan_id uuid, race_event_id uuid,
              role text, my_status text, owner_name text, partners jsonb,
              goal_target_ms bigint, goal_run_ms bigint,
              goal_station_ms bigint, goal_roxzone_ms bigint)
language sql
stable
security definer
set search_path = public
as $$
  select * from my_race_plans() where id = p_plan;
$$;

grant execute on function public.my_race_plan(uuid) to anon, authenticated;
