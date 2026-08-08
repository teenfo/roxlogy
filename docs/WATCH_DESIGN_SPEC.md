# Roxlogy 워치 UI 디자인 스펙 (v0.5.0)

> 디자인 도구(클로드 디자인 등)에서 워치 화면을 **그대로 재현**하기 위한 기술 스펙.
> 수치는 전부 구현 코드(`android/wear/`)에서 추출한 실제 값이다.
> 대상 하드웨어: **원형 Wear OS** (Galaxy Watch, 450×450px ≈ 1.5", 다크 UI 고정).
> 단위: dp/sp (Compose 기준). 원형 화면이므로 모서리 콘텐츠는 잘림 — 안전 패딩 필수.

---

## 1. 디자인 토큰

### 1.1 컬러 (`ui/theme/RoxWearTheme.kt`)

| 토큰 | HEX | 용도 |
|---|---|---|
| RaceYellow (primary) | `#FFD500` | 주 액션 버튼 배경, 강조 텍스트, 스테이션 링 |
| primaryVariant | `#CCAA00` | (테마 변형) |
| TrackBlue (secondary) | `#2D7DFF` | 러닝 링, RUN 라벨, 전송 상태 |
| secondaryVariant | `#1E5CC4` | (테마 변형) |
| RoxBlack (background) | `#141414` | 전 화면 배경 |
| Surface | `#1F1F1F` | 카드·표면 |
| SurfaceHi | `#2A2A2A` | 보조 칩 배경, 구분선 |
| Chalk (onBackground/onSurface) | `#F4F4F2` | 기본 텍스트 |
| MutedText (onSurfaceVariant) | `#9A9A96` | 보조 텍스트, 라벨 |
| Good | `#35C26B` | 목표보다 빠름(−), 완료 ✓ |
| Bad (error) | `#FF6B6B` | 목표보다 느림(+), 종료·에러 |
| onPrimary | `#000000` | 옐로 버튼 위 텍스트 |

시뮬 단계 배경(센터 서클 틴트):

| 토큰 | HEX | 단계 |
|---|---|---|
| RunBg | `#0D1E3C` | 런 |
| StationBg | `#2E2700` | 스테이션 |
| RoxzoneBg | `#33332E` | 록스존 |

링 전용 상태색(`SimRings.kt`):

| 토큰 | HEX | 의미 |
|---|---|---|
| Yellow | `#FFD500` | 완료된 스테이션 세그먼트 |
| YellowActive | `#8A7A1E` | 진행 중 스테이션 세그먼트 |
| YellowDim | `#2B2A12` | 미완료 세그먼트 |
| Blue | `#2D7DFF` | 러닝 진행 아크 |
| BlueDim | `#14213F` | 러닝 트랙 바탕 |

심박 존 컬러(`hrZoneColor`):

| bpm | 컬러 |
|---|---|
| < 120 | MutedText `#9A9A96` |
| 120–139 | TrackBlue `#2D7DFF` |
| 140–159 | Good `#35C26B` |
| 160–174 | `#FFA726` (주황) |
| ≥ 175 | Bad `#FF6B6B` |

### 1.2 타이포그래피

- 전역 폰트: **IBM Plex Sans KR** (Regular 400 / Bold 700, 앱 번들). 테마 `defaultFontFamily`로 모든 텍스트에 적용.
- 워드마크 "ROXLOGY": 15sp / weight **900(Black)** / letterSpacing **1.5sp** / 대문자 / RaceYellow — Archivo Black 스타일 재현.

사이즈 스케일 (sp) 과 대표 용도:

| sp | weight | 용도 |
|---|---|---|
| 9 | 400 | 서브라벨(MetricCell·칩 secondary), 힌트, 페이지 인디케이터 |
| 10 | 400 | 뷰 타이틀("상세"/"스플릿"), 보조 안내 |
| 11 | 400 | 본문 보조, 설명, STATION n 라벨 |
| 12 | 400 | 보조 칩 라벨, 리스트 본문 |
| 13 | 700 | 헤더 종목명 칩 |
| 14 | 700 | 단계 헤더(RUN n·록스존), 다이얼로그 제목, 컨트롤 버튼 |
| 15 | 700 | 주 액션 칩 라벨, 메뉴 칩 라벨, 비머신 종목명, 워드마크 |
| 16 | 700 | MetricCell 값, 상세 뷰 심박 |
| 20 | 700 | (WOD 이전 타이머 — 현재 22) |
| 22 | 700 | 상세 뷰 타이머, WOD 현재 항목 타이머 |
| 26 | 700 | 완료(DONE) 총시간 |
| 28–30 | 700 | RUNNING 메인 타이머 (30), 에르그 타이머 (30) |

숫자 시간 포맷: `m:ss`, 1시간 이상 `h:mm:ss`. diff는 `-m:ss`(Good) / `+m:ss`(Bad).

### 1.3 형태·간격

- 칩(버튼)은 전부 **필(pill) 형태** (Wear Chip 기본).
- **주 액션 칩**: 폭 `fillMaxWidth(0.85~0.9)` · 높이 **40dp** · 라벨 15sp Bold 중앙정렬 · RaceYellow 배경/검정 텍스트(기본).
- **보조 칩**(SubActionChip): CompactChip(가시 높이 32dp) · SurfaceHi 배경 · 흰 텍스트 12sp.
- 리스트 화면은 `ScalingLazyColumn`(스크롤 시 스케일·페이드, 베젤 회전 지원) + 상단 `TimeText`(현재 시각).
- 시뮬 서클 콘텐츠 패딩: **horizontal 40dp / vertical 34dp**.
- 요소 간 기본 간격: 2–4dp(시뮬 내부), 리스트 아이템은 컴포넌트 기본.

---

## 2. 브랜드 불변 규칙 (위반 금지)

1. 바깥 **옐로 링은 항상 8조각** — 개수 변경 금지.
2. 안쪽 **블루 링은 절대 끊지 않는다** — 연속 원. 진행 표시도 이어진 아크로만.
3. "HYROX" 상표를 화면 타이틀·앱 이름에 쓰지 않는다(설명문 내 호환성 언급만).
4. 배경은 항상 RoxBlack `#141414` — 라이트 테마 없음.

---

## 3. 공통 컴포넌트

| 컴포넌트 | 스펙 |
|---|---|
| `BrandHeader` | "ROXLOGY" 워드마크(1.2절) + 옵션 서브(10sp MutedText), 세로 중앙 정렬 |
| `PrimaryActionChip` / `ActionChip` | 1.3절 주 액션 칩. 색 변형: 시작·완료·전송=Yellow/검정, 1km 완료=TrackBlue/흰, 록스존 진행=Chalk/검정 |
| `SubActionChip` | 1.3절 보조 칩 |
| `MenuChip` | full-width Chip. 좌측 아이콘 글리프(15sp, 기본 RaceYellow) + 라벨 15sp Bold + secondaryLabel 10sp 1줄 ellipsis. primary 변형은 Yellow 배경/검정 |
| `MetricCell` | 세로: 값 16sp Bold(색 지정) + 서브라벨 9sp MutedText, 중앙 정렬 |
| `DiffBadge` | "목표 -0:12" 11sp, ≤0 Good / >0 Bad |
| 다이얼로그 | Wear `Alert` — 제목 14sp 중앙, 본문 11sp MutedText, 좌 negative(SurfaceHi 칩) / 우 positive(Yellow 칩) 12sp |
| T자 분할 행 | `Row` 50:50, 가운데 **1dp 세로 구분선(SurfaceHi)**, 각 칸 = MetricCell |

---

## 4. 두 링(SimRings) 지오메트리 — 정확값

캔버스 한 변 `w` = min(width, height). 중심 (cx, cy).

```
바깥 옐로 링 (스테이션 8세그먼트)
  stroke   = w × 0.055          (StrokeCap.Butt)
  반지름 rO = w/2 − stroke
  세그먼트  = 45° − 7°(gap), 시작각 −90°(12시) + i×45° + 3.5°
  색: i < 완료수 → Yellow / i == 진행중 → YellowActive / 그 외 → YellowDim

안쪽 블루 링 (러닝 트랙)
  stroke   = w × 0.05           (StrokeCap.Round)
  반지름 rI = rO − 바깥stroke×0.6 − 안쪽stroke×1.4
  바탕: BlueDim 360° 연속원
  진행: Blue, −90°부터 시계방향 360°×progress (0..1, 1km = 한 바퀴)

센터 서클 (단계 배경 틴트)
  지름 = 화면의 70% (fillMaxSize(0.70), CircleShape)
  색 = RunBg / StationBg / RoxzoneBg, IDLE·DONE·일시정지 시 투명
```

---

## 5. 화면별 스펙

### 5.0 화면 목록·라우팅

`Screen = { MENU, SIM, ARCHIVE, SETTINGS, GOAL, WOD, ERG }` — 메뉴에서 진입, 뒤로가기로 복귀(시뮬 RUNNING만 종료 확인).

### 5.1 메뉴 (MENU)

ScalingLazyColumn + TimeText.

```
[BrandHeader  sub="HYROX 트레이닝"]
(진행 스냅샷 있으면) [▶ 이어서 기록  · "진행 중인 시뮬 있음"]  ← primary(Yellow)
                    [↻ 새 레이스 시뮬]
(없으면)            [▶ 레이스 시뮬  · "8×1km + 8 스테이션"]     ← primary
[✓ 오늘의 WOD  · "프로그램 워크아웃" | "폰에서 동기화 필요"]
[⚡ 에르그      · "PM5 단독 기록"]
[◎ 목표        · "목표 스플릿 확인"]
[▤ 보관함      · "최근 세션 · 재전송"]
[⚙ 설정]
```

### 5.2 레이스 시뮬 (SIM)

구조: **HorizontalPager 2페이지** — page0 = 메인, page1(좌 스와이프) = 컨트롤.
page0 내부는 **VerticalPager 3뷰** — ①링 뷰 ②상세 뷰 ③스플릿 뷰.

#### 5.2.1 링 뷰 (기본) — 고정 3영역 레이아웃

배경: SimRings(전체) + 센터 서클 틴트. 콘텐츠 Column 패딩 H40/V34, 세로 weight **1.1 : 1.6 : 1.2**.

**헤더 영역 (weight 1.1, 하단 정렬)** — 상태별:
- IDLE: BrandHeader("레이스 시뮬")
- RUN: `RUN n` 14sp Bold TrackBlue
- STATION: `STATION n` 11sp RaceYellow + 종목명 15sp Bold. **머신 종목(SkiErg·Rowing)이면 종목명이 CompactChip(높이 30dp)**: 미연결=SurfaceHi/흰 "Rowing", 연결중="연결 중…", 연결됨=StationBg/RaceYellow "Rowing ✓" — 탭=PM5 연결
- 록스존: `록스존 · 이동` 14sp Bold Chalk
- 일시정지: `일시정지됨` 14sp Bold Chalk
- DONE/SENT: `시뮬 완료 ✓`/`전송됨 ✓` 14sp Bold RaceYellow

**정보 영역 (weight 1.6, 중앙)** — 상태별:
- IDLE: "8×1km + 8 스테이션\n32구간 기록" 11sp MutedText + **[PM5 미리 연결]** CompactChip(미연결 SurfaceHi / 연결중 "PM5 연결 중…" / 연결됨 StationBg·RaceYellow "PM5 ✓")
- RUNNING: 타이머 **30sp Bold** + (일시정지 아님) **T자 분할 행**:
  - 좌 칸(항상): 심박 값 16sp Bold(존 컬러, 미수신 `--` MutedText) / 서브 "♥ 심박"
  - 우 칸(상황별 1개): 런 → `412m`/"/ 1km"(트래커 없으면 `탭=랩`/"수동 랩") · 머신+PM5 연결 → `230W` RaceYellow/`32spm` · 그 외 → diff `-0:12`(Good/Bad)/"목표 m:ss"
- DONE/SENT: 총시간 26sp Bold + DiffBadge + 요약 2줄 9sp MutedText("런 m:ss · 스테이션 m:ss" / "록스존 m:ss · ♥avg/max")

**액션 영역 (weight 1.2, 상단 정렬)** — 주 액션은 항상 같은 위치:
- IDLE: [시작](Yellow) + [메뉴](Sub)
- RUNNING 런: [1km 완료](TrackBlue/흰)
- RUNNING 록스존: [스테이션 시작]/[런 시작]/[피니시](Chalk/검정 — 다음 슬롯에 따라)
- RUNNING 스테이션: [완료](Yellow)
- 일시정지: [▶ 재개](Yellow)
- DONE: [전송](Yellow) + [↩ 랩 취소](Sub)
- SENT: [새 시뮬](Yellow) + [메뉴](Sub)

#### 5.2.2 상세 뷰 (상하 스와이프 ②)

세로 중앙 정렬, spacing 3dp, 패딩 H34: "상세" 10sp → 타이머 22sp Bold → `♥ 142 bpm` 16sp Bold 존컬러(미수신 `♥ --` 14sp Muted) → PM5 라이브 `230W · 32spm · m:ss/500m` 12sp RaceYellow → `구간 목표 m:ss` 11sp Muted → DiffBadge → `다음: Sled Push` 11sp Chalk.

#### 5.2.3 스플릿 뷰 (③)

세로 스크롤 리스트, 패딩 H40/V28: "스플릿" 10sp → 행마다 [라벨(런1/종목명/록스존) 11sp Muted | 시간 우측].

#### 5.2.4 컨트롤 페이지 (좌 스와이프)

세로 중앙 버튼 3개(Chip, SurfaceHi, 14sp): [⏸ 일시정지 / ▶ 재개] [↩ 랩 되돌리기(첫 구간이면 비활성)] [✕ 시뮬 종료(라벨 Bad 컬러)] + 페이지 인디케이터 `● ○` 9sp.

#### 5.2.5 종료 확인 다이얼로그

제목 "시뮬을 종료할까요?" / 본문 "진행 기록은 저장되어\n'이어서 기록'으로 복귀할 수 있습니다" / [계속](Sub) [종료](Yellow).

#### 5.2.6 앰비언트(AOD) 간소 화면

검정 배경 + 타이머 + 현재 단계 라벨만(저전력, 컬러 최소화).

### 5.3 에르그 단독 (ERG)

세로 중앙 Column(spacing 4dp) + TimeText. 상단 고정 타이틀 "에르그" 12sp Bold RaceYellow.
상태 머신 `idle → running → done → sent`.

**idle · 기기 미선택**: "기기 선택" 11sp Muted → [SkiErg] [RowErg] CompactChip(SurfaceHi/흰, 가로 배치 gap 6dp) → "PM5에서 Menu → Connect 를 연 뒤 선택" 9sp Muted. 종목 탭 = 즉시 스캔.

**idle · 선택 후**: 연결 상태 11sp — 연결됨 `SkiErg 연결됨 ✓` + 줄바꿈 후 모니터 이름(TrackBlue) / "연결 중…" / "연결 안 됨"(+실패 사유 9sp Muted 중앙, 최대 폭 0.85). 연결됨이면 라이브 미리보기 10sp + **[시작]**(주 액션). 미연결이면 **[다시 연결]**(주 액션). 하단 [기기 변경](CompactChip SurfaceHi).

**running**: 종목명 11sp Muted → 타이머 **30sp Bold** → **T자 분할**: 좌 `230W` RaceYellow/`45spm` · 우 `128m` 흰/`2:07/500m`(페이스 없으면 "페이스 --") → (끊김 시) "연결 끊김 — 재연결 대기" 9sp → **[종료]**(주 액션).

**done**: 시간 26sp Bold → "N 샘플 · 평균 152W" 11sp Muted → **[전송]**(주 액션) + [버리기](CompactChip SurfaceHi).

**sent**: `전송됨 ✓` 15sp Bold RaceYellow → "세션 목록에서 곡선·지표 확인" 10sp → **[새 기록]**(주 액션).

### 5.4 오늘의 WOD (WOD)

ScalingLazyColumn + TimeText. 헤더: WOD 제목(RaceYellow Bold, 1줄 ellipsis).

- 미수신: "오늘의 WOD 없음\n폰 앱 [워치] 탭에서\n동기화하거나 프로그램을\n등록하세요" 11sp 중앙.
- 진행: **현재 항목 카드**(Surface) — "지금" 9sp Muted / 항목명 15sp Bold(2줄) / 노트 10sp Muted / 타이머 **22sp Bold RaceYellow** → (에르그 항목이면) PM5 연결 칩(미연결 "SkiErg 연결" SurfaceHi → "PM5 연결 중…" → 연결됨 "PM5 ✓ 230W·32spm") → **[완료]**(주 액션, full width) → "전체 목록" 10sp 헤더 → 항목 행: 상태 글리프(✓ Good / ▶ RaceYellow / ○ Muted) 12sp + 이름 12sp(완료 시 Muted) + 노트 9sp.
- 전체 완료: `오늘의 WOD 완료 ✓` 14sp Bold Good + 목록(전부 ✓).

### 5.5 목표 (GOAL)

ScalingLazyColumn. 헤더 "목표 스플릿"(RaceYellow Bold).
- 목표 없음: "저장된 목표 없음\n폰 앱 [워치] 탭에서\n목표를 보내세요" 11sp 중앙.
- 있음: `MetricRow` 카드(라벨 11sp Muted 좌 + 값 우측 RaceYellow Bold, big=18sp/기본 14sp) — 총시간(big) / 1km 랩 / 록스존 1회 → "스테이션" 섹션 헤더 → 스테이션별 8행.

### 5.6 보관함 (ARCHIVE)

ScalingLazyColumn. 헤더 "보관함".
- 항목 = Card 2줄: 날짜 `M/d (E) HH:mm` 12sp / 총시간 15sp Bold RaceYellow + 상태("전송됨" Muted / "대기" Muted / "재전송함 ✓" TrackBlue) 10sp. 탭 = 재전송.
- 푸터: "최근 20세션 · 72시간 보관 · 탭 = 재전송" 9sp 중앙.

### 5.7 설정 (SETTINGS)

ScalingLazyColumn. 헤더 "설정".
- ToggleChip(스위치 아이콘) ×4: 햅틱 피드백("랩·완료 시 진동") / 화면 항상 켜기("시뮬 중 화면 유지 (배터리↓)") / 앰비언트 모드("꺼짐 시 저전력 간소 화면") / **짐 모드**("스테이션 종료 시 PM5 연결 해제"). 라벨 13sp + 서브 9sp.
- "PM5" 섹션 헤더 → **PM5 연결 테스트** Chip: idle "PM5 연결 테스트" / scanning "PM5 검색 중…" / ok "PM5 연결됨 ✓ {이름|라이브}" / fail "PM5 연결 실패 — 다시 탭"(+사유 서브 최대 4줄). 서브 기본 "PM5 Menu → Connect 화면에서 탭".
- **기억한 PM5 지우기** Chip(SurfaceHi) — 탭 후 "기억한 PM5 지움 ✓". 서브 "머신을 바꿨을 때 초기화".
- 푸터: 버전 문자열 9sp 중앙 (예: "v0.5.0").

---

## 6. 상태 머신

### 6.1 시뮬 `AppPhase`

```
IDLE ─시작→ RUNNING ─32구간 완료→ DONE ─전송→ SENT ─새 시뮬→ IDLE
RUNNING: 일시정지(paused) 토글 · 랩 되돌리기(undo, DONE→RUNNING 복귀 가능)
뒤로가기(RUNNING/paused) → 종료 확인 → 스냅샷 저장 후 메뉴
```

슬롯 순서: `(런 → 록스존IN → 스테이션 → 록스존OUT) × 8` = 32. 스테이션 순서: SkiErg → Sled Push → Sled Pull → Burpee BJ → Rowing → Farmers → Lunges → Wall Balls.

### 6.2 에르그 `phase`: `idle → running → done → sent` (5.3절)

### 6.3 PM5 연결 상태

`미연결 → 스캔(최대 30초) → 연결(GATT) → 연결됨(ready) ⇄ 끊김(자동 재연결 대기)`
실패 시 사유 문자열 노출: "블루투스가 꺼져 있습니다" / "PM5를 찾지 못함 · 주변 BLE 0대 — …" / "PM5를 찾지 못함 · 주변 N대 검색됨 (이름…) — PM5에서 Menu → Connect 를 연 뒤 다시 시도하세요" / "BLE 스캔 실패 (코드 N)" / "PM5 연결 실패 (status N)" / "PM5 연결이 지연됩니다 — 다시 시도하세요" / "PM5 로잉 서비스를 찾지 못했습니다" / "PM5 상태 특성을 찾지 못했습니다" / "PM5 알림 구독 실패 (status N)".

---

## 7. 인터랙션 맵

| 입력 | 컨텍스트 | 동작 |
|---|---|---|
| 좌 스와이프 | 시뮬 | 컨트롤 페이지 |
| 상/하 스와이프 | 시뮬 메인 | 링 ↔ 상세 ↔ 스플릿 뷰 |
| 베젤/용두 회전 | 리스트 화면 | 스크롤 |
| 물리 퀵버튼(STEM) | 시뮬 RUNNING | 현재 구간 랩(=주 액션) |
| 뒤로가기 | 시뮬 RUNNING | 종료 확인 다이얼로그 |
| 뒤로가기 | 그 외 | 메뉴 복귀 |
| 화면 꺼짐 | 시뮬 | 포그라운드 서비스 유지 + 워치페이스 하단 Ongoing 아이콘(탭=복귀) |

## 8. 모션·햅틱

- 햅틱(설정 켬 시): 랩 60ms · 완료/DONE 200ms · 전송 120ms.
- 페이저 전환은 시스템 기본 스와이프 애니메이션. 별도 장식 모션 없음 — "데이터가 말하게" 하는 미니멀 톤 유지.
- 링 진행은 상태 변화 시 즉시 갱신(트윈 없음).
