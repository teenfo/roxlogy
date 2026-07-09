-- WOD(워크아웃) 완료 추적: 사용자가 워크아웃 상세에서 운동을 하나씩 완료 체크하고,
-- 모두 완료되면 WOD가 완료된 것으로 본다. 완료는 프로그램 소유자가 아니라 '수행한
-- 사용자' 소유다(공개 프로그램을 등록해 따라 할 수 있으므로). 따라서 프로그램/템플릿
-- 테이블과 분리된 사용자 소유 테이블로 둔다.
--
-- 진행률 = 완료 아이템 수 / 전체 아이템 수. WOD 완료 처리 = 모든 아이템 완료 행 삽입,
-- WOD 완료 취소 = 해당 템플릿 아이템 완료 행 전체 삭제 (클라이언트가 수행).
create table if not exists workout_item_completions (
  -- 삽입 시 클라이언트가 user_id를 보내지 않아도 되도록 auth.uid() 기본값
  -- (RLS insert with check (user_id = auth.uid())와 함께 본인 소유 강제)
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id uuid not null references workout_template_items (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

-- 템플릿 단위 집계(진행률·완료 판정)를 위한 조회 최적화
create index if not exists idx_wic_item on workout_item_completions (item_id);

alter table workout_item_completions enable row level security;

-- 본인 완료 기록만 조회/생성/삭제 가능
create policy wic_select_own on workout_item_completions
  for select using (user_id = auth.uid());
create policy wic_insert_own on workout_item_completions
  for insert with check (user_id = auth.uid());
create policy wic_delete_own on workout_item_completions
  for delete using (user_id = auth.uid());
