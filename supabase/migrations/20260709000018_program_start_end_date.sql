-- 프로그램에 시작·종료 날짜(선택). 각 일차(day_index)의 실제 날짜 = start_date + (day_index-1).
-- 상세·빌더 화면에서 일차마다 해당 캘린더 날짜를 표시한다.
alter table programs add column if not exists start_date date;
alter table programs add column if not exists end_date date;
