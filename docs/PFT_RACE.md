# PFT 레이스 보드 (현장 측정 중계) — 2026-09-12

## 흐름
1. **생성**: 전체 관리자 또는 크루 운영진이 `/pft/race/new` 에서 레이스를 만든다 → 6자리 참가 코드.
2. **참가**: 참가자가 `/pft/race/join` 에 코드를 넣거나 `/pft/race/<코드>` 를 열어 참가한다.
3. **측정**: 참가자 폰(파트너가 들고 눌러도 됨)에서 ▶ 시작 → 종목이 끝날 때마다 큰 버튼 한 번.
   각 탭이 서버에 동기화된다. 오프라인이면 localStorage 큐에 쌓였다가 순서대로 재전송.
4. **중계**: `/board/<코드>` 공개 보드(로그인 불필요, TV·프로젝터용)가 Realtime 으로 순위·진행을 보여 준다.
5. **완주**: 6번째 스플릿에서 `pft_results` 행이 자동 생성돼 개인 기록·리더보드·배지에 반영된다.
6. **종료**: 운영진이 종료하면 참가·기록이 잠긴다(다시 열 수 있음).

## 시각 규칙
- 스플릿은 **참가자 폰이 잰 "시작 이후 누적 ms"** — 네트워크 지연·오프라인과 무관하게 정확하다.
- 시작 시각(`started_at`)만 서버 `now()`. 보드는 `server_now` 로 오프셋을 재서 진행 중 참가자의 경과를 흐르게 한다.
- 서버는 스플릿의 단조 증가(직전보다 커야 함)와 상한(3시간)만 검증한다.

## DB (마이그레이션 092)
- `pft_races(code, title, crew_id, created_by, status open|closed)`, `pft_race_entries(race_id, user_id, started_at, splits int[], finished_at, total_ms, scaled, result_id)`.
- 읽기는 누구나(RLS select true), 쓰기는 RPC 만: `pft_race_create`, `pft_race_set_status`(운영진), `pft_race_join`, `pft_race_start`, `pft_race_split`, `pft_race_undo`, `pft_race_reset`, `pft_race_my_entry`(본인), `pft_race_board`(anon 허용).
- `pft_race_entries` 는 `supabase_realtime` 게시 + replica identity full. 보드는 변경 이벤트를 신호로만 쓰고 데이터는 `pft_race_board()` 로 다시 읽는다(이름 해석 포함). 5초 폴링 예비.

## 순위
완주(총시간↑) → 진행 중(더 앞선 종목, 같으면 경과↑) → 대기(참가 순). 코드: `web/lib/pft-race.ts`.

## 아직 없는 것
- 운영진이 한 태블릿으로 여러 명을 찍는 "스태프 타이밍" 모드, 웨이브(조) 공통 출발, 게스트(비회원) 참가, QR 코드, MCP 도구.
