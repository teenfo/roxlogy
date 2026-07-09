-- 세션 디비전 + 레이스 결과 라이브 링크
-- 디비전은 프로필이 아니라 세션·레이스 단위로 관리한다(한 유저가 여러 디비전 출전 가능).
-- 레이스에서 생성된 세션은 race_result_id로 원본 레이스 결과와 연결되어,
-- 레이스 출전 날짜·시즌·디비전이 바뀌면 세션 화면에도 그대로 반영된다(조인 조회).

-- 세션 디비전 (레이스 연동 세션은 레이스 결과의 division을 사용하고 여기선 비워둠)
alter table sessions
  add column if not exists division text
    check (division in ('open', 'pro', 'doubles', 'pro_doubles', 'relay'));

-- 원본 레이스 결과로의 라이브 링크. 레이스 결과가 삭제되면 링크만 끊고 세션은 보존.
alter table sessions
  add column if not exists race_result_id uuid
    references race_results(id) on delete set null;

create index if not exists idx_sessions_race_result
  on sessions(race_result_id)
  where race_result_id is not null;

-- 레이스 결과 시즌(세션 카드에 대회·시즌·날짜 표시용)
alter table race_results
  add column if not exists season text;
