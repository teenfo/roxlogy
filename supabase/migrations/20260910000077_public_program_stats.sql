-- 커뮤니티 프로그램 카드용 — 작성자 이름과 참여 인원.
--
-- 둘 다 직접 조회할 수 없다: profiles 는 본인 행만 보이고,
-- program_enrollments 도 본인 것만 보인다. 공개 프로그램에 한해서만
-- 작성자 표시 이름(공개를 택한 사람)과 참여 **인원수**(집계라 개인이 아니다)를
-- 내려준다. 비공개 프로그램은 어떤 경우에도 포함하지 않는다.
create or replace function public.public_program_stats(p_ids uuid[])
returns table(program_id uuid, owner_name text, enroll_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         coalesce(pr.display_name, 'Athlete'),
         (select count(*) from program_enrollments e where e.program_id = p.id)
    from programs p
    left join profiles pr on pr.id = p.owner_id
   where p.id = any(p_ids)
     and p.is_public;
$$;

grant execute on function public.public_program_stats(uuid[]) to anon, authenticated;

-- 검증 — 비공개 프로그램은 절대 나오지 않는다
do $$
declare
  v_priv uuid;
  v_pub uuid;
  v_n int;
begin
  select id into v_priv from programs where not is_public limit 1;
  select id into v_pub from programs where is_public limit 1;
  if v_priv is not null then
    select count(*) into v_n from public_program_stats(array[v_priv]);
    if v_n <> 0 then raise exception 'private program leaked'; end if;
  end if;
  if v_pub is not null then
    select count(*) into v_n from public_program_stats(array[v_pub]);
    if v_n <> 1 then raise exception 'public program missing'; end if;
  end if;
end $$;
