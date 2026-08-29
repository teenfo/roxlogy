-- ============================================================
-- Roxlogy — 회비 납부 링크에 금액 추가 + 링크 선택화
--
-- 통장입금으로 내는 멤버도 금액을 봐야 하므로 항목에 금액을 넣고,
-- 링크 없이 명칭+금액만(계좌이체 안내용)도 등록할 수 있게 url 을
-- 선택 사항으로 바꾼다. 소개 탭에는 금액이 함께 표시되고,
-- url 이 있는 항목만 "납부하기" 버튼이 붙는다.
-- ============================================================

alter table public.crew_dues_links
  add column if not exists amount int check (amount is null or amount > 0);

alter table public.crew_dues_links
  alter column url drop not null;

alter table public.crew_dues_links
  drop constraint if exists crew_dues_links_url_check;
alter table public.crew_dues_links
  add constraint crew_dues_links_url_check
    check (url is null or (url ~* '^https?://' and char_length(url) <= 500));
