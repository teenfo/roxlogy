-- ============================================================
-- Roxlogy — 프로그램 주간 패턴 (요일)
--
-- 새 프로그램 화면에서 훈련 요일을 고르면 그만큼 일자를 미리 만든다.
-- 어떤 요일을 골랐는지 남겨 둬야 빌더가 "3일차 = 금요일"을 보여줄 수 있다.
-- 0=월 … 6=일. 비어 있으면 예전 프로그램(요일 개념 없음).
--
-- 덧붙이기만 하는 변경이라 배포 순서를 신경 쓰지 않아도 된다(옛 코드는 무시).
-- ============================================================

alter table public.programs
  add column if not exists week_pattern smallint[]
    check (
      week_pattern is null
      or (array_length(week_pattern, 1) between 1 and 7
          and week_pattern <@ array[0,1,2,3,4,5,6]::smallint[])
    );

comment on column public.programs.week_pattern is
  '훈련 요일 (0=월 … 6=일). 새 프로그램에서 일자를 미리 만들 때 쓴 패턴.';
