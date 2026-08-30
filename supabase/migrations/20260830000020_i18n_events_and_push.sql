-- ============================================================
-- Roxlogy — 시스템 감사 수리 (8) 대회 일정·푸시 알림 다국어
--
-- 1) 알림 설정 UI 는 3개 언어인데 실제 발송 문구는 한국어 고정이었다.
--    profiles.locale 을 추가해 수신자 언어로 제목·본문을 고른다.
-- 2) race_events 는 city·country·date_note 가 한국어로만 저장돼 en/es
--    사용자에게도 한국어가 노출됐다. city_en·country_code(ISO2)·
--    date_status('scheduled'|'held')를 추가해 화면이 로케일로 조립한다.
--    (표시용 한국어 컬럼은 그대로 두어 ko 화면과 기존 검색은 유지)
-- ============================================================

alter table public.profiles
  add column if not exists locale text
    check (locale is null or locale in ('ko','en','es'));

alter table public.race_events
  add column if not exists city_en text,
  add column if not exists country_code text,
  add column if not exists date_status text
    check (date_status is null or date_status in ('scheduled','held'));

update race_events set country_code = case country
  when '남아프리카공화국' then 'ZA' when '네덜란드' then 'NL' when '대만' then 'TW'
  when '대한민국' then 'KR' when '미국' then 'US' when '브라질' then 'BR'
  when '싱가포르' then 'SG' when '아르헨티나' then 'AR' when '인도' then 'IN'
  when '인도네시아' then 'ID' when '일본' then 'JP' when '중국' then 'CN'
  when '캐나다' then 'CA' when '태국' then 'TH' when '튀르키예' then 'TR'
  when '호주' then 'AU' when '홍콩' then 'HK' else null end
where country_code is null;

-- 도시 영문명: API 값이 있으면 그것, 없으면 이벤트명에서 'HYROX ' 접두와 한글 꼬리를 제거
update race_events
set city_en = coalesce(
  nullif(api_city, ''),
  nullif(btrim(regexp_replace(regexp_replace(name, '^HYROX\s+', ''), '[가-힣0-9]+\s*$', '')), ''))
where city_en is null;

update race_events set date_status =
  case when date_note like '%개최됨%' then 'held'
       when date_note like '%예정%' then 'scheduled'
       else null end
where date_status is null and date_note is not null;

create or replace function public.notify_new_follower()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_loc text;
  v_title text;
  v_body text;
begin
  select coalesce(locale, 'ko') into v_loc from public.profiles where id = new.followee_id;
  select nullif(display_name, '') into v_name from public.profiles where id = new.follower_id;
  v_name := coalesce(v_name, case v_loc when 'en' then 'Someone'
                                        when 'es' then 'Alguien' else '누군가' end);
  v_title := case v_loc when 'en' then 'New follower'
                        when 'es' then 'Nuevo seguidor' else '새 팔로워' end;
  v_body := case v_loc
    when 'en' then v_name || ' started following you.'
    when 'es' then v_name || ' ha empezado a seguirte.'
    else v_name || '님이 회원님을 팔로우하기 시작했습니다.' end;
  perform public.enqueue_notification(
    new.followee_id, 'new_follower', v_title, v_body,
    '/u/' || new.follower_id::text);
  return new;
end;
$$;

create or replace function public.enqueue_wod_reminders()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  r record;
  v_loc text;
begin
  for r in
    select p.id, p.timezone, p.wod_reminder_time, coalesce(p.locale, 'ko') as loc,
           (now() at time zone coalesce(p.timezone, 'UTC')) as local_now
    from public.profiles p
    where p.wod_reminder_time is not null
  loop
    if mod(cast(extract(epoch from (r.local_now::time - r.wod_reminder_time)) as integer) + 86400, 86400) < 300 then
      if not exists (
        select 1 from public.notifications n
        where n.user_id = r.id and n.type_key = 'wod_reminder'
          and (n.created_at at time zone coalesce(r.timezone, 'UTC'))::date = r.local_now::date
      ) then
        v_loc := r.loc;
        perform public.enqueue_notification(
          r.id, 'wod_reminder',
          case v_loc when 'en' then 'Today''s WOD'
                     when 'es' then 'El WOD de hoy' else '오늘의 WOD' end,
          case v_loc when 'en' then 'Check today''s workout and log it.'
                     when 'es' then 'Consulta el entrenamiento de hoy y regístralo.'
                     else '오늘의 워크아웃을 확인하고 기록해 보세요.' end,
          '/dashboard');
        v_count := v_count + 1;
      end if;
    end if;
  end loop;
  return v_count;
end;
$$;

do $$
declare v_bad int;
begin
  select count(*) into v_bad from race_events where country_code is null;
  if v_bad > 0 then raise exception '% events lack country_code', v_bad; end if;
  select count(*) into v_bad from race_events where nullif(city_en,'') is null;
  if v_bad > 0 then raise exception '% events lack city_en', v_bad; end if;
end $$;
