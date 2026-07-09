-- 믹스 더블 / 믹스 릴레이를 디비전에 추가 (sessions.division 제약 갱신)
alter table sessions drop constraint if exists sessions_division_check;
alter table sessions add constraint sessions_division_check
  check (division is null or division = any (array[
    'open','pro','doubles','mixed_doubles','pro_doubles','relay','mixed_relay'
  ]));
