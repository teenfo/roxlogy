# PFT 레이스 보드 (현장 측정 중계) — 2026-09-12

## 흐름
1. **생성**: 전체 관리자 또는 크루 운영진이 `/pft/race/new` 에서 레이스를 만든다 → 6자리 참가 코드.
2. **참가**: 참가자가 `/pft/race/join` 에 코드를 넣거나 `/pft/race/<코드>` 를 열어 참가한다.
3. **측정**: 참가자 폰(파트너가 들고 눌러도 됨)에서 ▶ 시작 → 종목이 끝날 때마다 큰 버튼 한 번.
   각 탭이 서버에 동기화된다. 오프라인이면 localStorage 큐에 쌓였다가 순서대로 재전송.
4. **중계**: `/board/<코드>` 공개 보드(로그인 불필요, TV·프로젝터용)가 Realtime 으로 순위·진행을 보여 준다.
5. **완주**: 6번째 스플릿에서 `pft_results` 행이 자동 생성돼 개인 기록·리더보드·배지에 반영된다.
6. **종료**: 운영진이 종료하면 참가·기록이 잠긴다(다시 열 수 있음).

## 측정 화면은 하나다
일반 측정(`/pft/measure`)과 레이스 측정(`/pft/race/<코드>`)은 같은 화면 `web/components/pft-measure-view.tsx`(표시 전용)를 쓴다.
시계 카드·종목 목록·완주 카드가 한 곳에만 있고, 부모가 상태 저장 위치만 다르게 잇는다:
- `pft-measure.tsx` — 브라우저(localStorage)에 두고 완주 뒤 "기록 저장"으로 `pft_results` 에 넣는다.
- `pft-race-runner.tsx` — 시작·종목 완료를 레이스 RPC 로 동기화하고, 6번째 완료에서 서버가 기록을 만든다. 참가 카드·코드·보드 버튼·운영 카드는 슬롯(`headerExtra`/`beforeClock`/`finishExtra`/`afterList`)으로 끼운다.
둘 다 내 최고 기록으로 "예상 완주"와 구간 PB 비교를 보여 준다.

## 공개 보드 레이아웃 (`/board/<코드>`, 2026-09-12 핸드오프)
1920×1080 TV 기준 3분할: 상단 레이스 종합(제목·상태·스테이션 범례·참가/측정 중/완주/최고 기록·참가 코드) /
하단 좌 "측정 중"(현재 스테이션 배지 + 6구간 진행 바 + 큰 경과 타이머, 최대 6명 뒤 "+N") /
하단 우 "완주 리더보드"(순위·배지·기록·리더 격차, 60초 내 완주 NEW, 로그인 사용자 본인 ME, 12행 초과는 8초 페이지 로테이션).
현재 구간 진행률은 리더의 같은 구간 스플릿 대비, 없으면 본인 직전 구간 평균 대비(기준 없으면 펄스). 1280px 미만은 세로 스택, 폰에서는 6구간이 3×2.
상단 바 `pft-board-topbar.tsx`: LIVE 점(펄스) + 현재 시각(1초).

## 시각 규칙
- 스플릿은 **참가자 폰이 잰 "시작 이후 누적 ms"** — 네트워크 지연·오프라인과 무관하게 정확하다.
- 시작 시각(`started_at`)만 서버 `now()`. 보드는 `server_now` 로 오프셋을 재서 진행 중 참가자의 경과를 흐르게 한다.
- 서버는 스플릿의 단조 증가(직전보다 커야 함)와 상한(3시간)만 검증한다.

## DB (마이그레이션 092)
- `pft_races(code, title, crew_id, created_by, status open|closed)`, `pft_race_entries(race_id, user_id, started_at, splits int[], finished_at, total_ms, scaled, result_id)`.
- 읽기는 누구나(RLS select true), 쓰기는 RPC 만: `pft_race_create`, `pft_race_set_status`(운영진), `pft_race_join`, `pft_race_start`, `pft_race_split`, `pft_race_undo`, `pft_race_reset`, `pft_race_my_entry`(본인), `pft_race_board`(anon 허용), 스태프용 `pft_race_search_members`, `pft_race_staff_add/start/split/undo/reset/remove`(운영진, 093).
- `pft_race_entries` 는 `supabase_realtime` 게시 + replica identity full. 보드는 변경 이벤트를 신호로만 쓰고 데이터는 `pft_race_board()` 로 다시 읽는다(이름 해석 포함). 5초 폴링 예비.

## 순위
완주(총시간↑) → 진행 중(더 앞선 종목, 같으면 경과↑) → 대기(참가 순). 코드: `web/lib/pft-race.ts`.

## 스태프 타이밍 (마이그레이션 093)
운영진(전체 관리자·크루 운영진)이 `/pft/race/<코드>/staff` 에서 **한 기기로 여러 참가자**를 찍는다. 참가자 폰이 없어도 된다.
- **등록**: 이름 검색(`pft_race_search_members` — 크루 레이스면 그 크루 활성 회원, 아니면 전체 프로필) → `pft_race_staff_add`.
- **웨이브 출발**: 대기 중 참가자를 체크해 `pft_race_staff_start(race, entries[])` — 같은 서버 `now()` 로 일괄 출발. 이미 출발·완주한 엔트리는 건너뛴다. 응답 `server_now` 로 스태프 기기의 시계 오프셋을 맞춘다.
- **종목 완료**: 참가자 카드의 큰 버튼. 경과 = (기기 시각 + 서버 오프셋) − `started_at`. 참가자별 localStorage 큐(`roxlogy.pft.staff.<코드>`)에 쌓였다가 순서대로 `pft_race_staff_split` 로 전송.
- **취소·초기화·제거**: `pft_race_staff_undo` / `pft_race_staff_reset` / `pft_race_staff_remove`(완주 기록은 soft delete).
- 스플릿 적용·완주 처리·취소 규칙은 자가 타이밍과 **한 코드**다: 내부 `_pft_apply_split/_pft_apply_undo/_pft_apply_reset` 을 자가 RPC(`pft_race_split/undo/reset`)와 스태프 RPC 가 같이 호출한다. 스태프 RPC 는 모두 `pft_race_can_manage` 로 막는다.
- 참가자 화면은 5초마다 `pft_race_my_entry` 를 다시 읽어 스태프가 출발·기록·초기화한 것을 따라간다. 두 경로가 같은 엔트리를 동시에 찍으면 서버의 단조 증가 규칙이 뒤늦은 쪽을 거부한다.
- 진입: 참가자 화면의 레이스 관리 카드 "스태프 타이밍 열기", `/pft` 허브의 "내가 만든 레이스".

## 아직 없는 것
- 게스트(비회원) 참가, QR 코드, MCP 도구.
