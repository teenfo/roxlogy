-- ============================================================
-- Roxlogy — mcp_crew 에 회비 계좌 노출 (크루원 한정)
--
-- links.bank_account 는 웹 소개 페이지와 동일하게 활성 멤버에게만 반환.
-- 공개 크루라도 비멤버 토큰에는 null.
-- ============================================================

create or replace function public.mcp_crew(p_token text, p_slug text default null)
returns jsonb
language sql stable security definer set search_path to 'public' as $$
  with u as (select mcp_uid(p_token) as id)
  select case
    when p_slug is null then coalesce((
      select jsonb_agg(jsonb_build_object(
        'slug', c.slug, 'name', c.name, 'tagline', c.tagline, 'role', m.role))
      from crew_members m join crews c on c.id = m.crew_id
      where m.user_id = (select id from u) and m.status = 'active'), '[]'::jsonb)
    else (
      select jsonb_build_object(
        'slug', c.slug, 'name', c.name, 'tagline', c.tagline,
        'description', c.description, 'location', c.location,
        'hours_weekday', c.links->>'hours_weekday',
        'hours_weekend', c.links->>'hours_weekend',
        'contact', c.links->>'phone',
        'official_link', c.links->>'official',
        'rules', c.links->>'policy',
        'bank_account', case when exists (
            select 1 from crew_members m
            where m.crew_id = c.id and m.user_id = (select id from u)
              and m.status = 'active')
          then c.links->>'bank_account' end,
        'member_count', (select count(*) from crew_members mm
                         where mm.crew_id = c.id and mm.status = 'active'),
        'my_role', (select m.role from crew_members m
                    where m.crew_id = c.id and m.user_id = (select id from u)
                      and m.status = 'active'))
      from crews c
      where c.slug = p_slug and c.status = 'active'
        and (c.is_public or exists (
          select 1 from crew_members m
          where m.crew_id = c.id and m.user_id = (select id from u)
            and m.status = 'active')))
  end
  from u where u.id is not null;
$$;
