# Roxlogy — 기획 문서

> **브랜드**: Roxlogy (록솔로지) — "Rox + -logy", 하이브리드 레이스를 데이터로 연구하는 앱
> **프로젝트 성격**: 일반 HYROX 유저 대상 공개 앱 — **독립 프로젝트** (다른 프로젝트와 자산·인프라 공유 없음)
> **핵심 차별점**: Wear OS 네이티브 지원 + Concept2 PM5(스키/로잉) 실시간 raw 데이터 연동 + 한국어 우선
> **구성**: 워치 (실행) — 폰 (관리/동기화) — 온라인 사이트 (저장/분석/커뮤니티) 3계층
> **MVP 시작점**: 온라인 사이트 (계정/서버/데이터 모델 토대)
> **플랫폼 전략**: Phase 1 Android(Wear OS + 폰) 우선 → 이후 Apple(watchOS + iPhone) 확장 (§9 참조)

---

## 1. 제품 개요

### 1.1 문제 정의
HYROX 훈련·기록 앱은 이미 여럿 존재하지만(TrainRox, ROXFIT, Edge, HyRhythm 등), 대부분 Apple Watch 중심이고 iOS 편향이다. **Wear OS 네이티브 + HYROX 전용** 조합은 사실상 빈 시장이며, 갤럭시 워치 비중이 높은 한국 시장과 특히 잘 맞는다. 여기에 Concept2 PM5(로잉·스키에르그)와 직접 BLE 연동해 raw 데이터를 수집·분석하는 앱은 거의 없다.

**핵심 벤치마크 — Roxlab (roxlab.app)**: 공식 HYROX 레이스 결과를 집계해 백분위 비교·스플릿 분석·목표 예측·훈련 플랜을 제공하는 레이스 분석 서비스. 대회당 수만 건, 4만+ 선수 비교군을 보유. 그러나 **훈련 중 실측 데이터가 없다** — 레이스 결과(사후 데이터)만 다루며, 워치 앱·에르그 연동·실시간 실행 도구가 없다. 우리 앱은 워치+PM5로 훈련 실측을 확보하므로, Roxlab류의 레이스 분석을 흡수하면 **"훈련 실측 × 레이스 결과"를 잇는 유일한 포지션**이 된다.

### 1.2 차별화 축
| 축 | 내용 | 경쟁 앱 대비 |
|---|---|---|
| Wear OS 네이티브 | 손목에서 세션 완주, 오프라인 우선 | 경쟁 앱 대부분 Apple Watch 전용 |
| PM5 raw 연동 | 스키/로잉 동시 연결, 스트로크 단위 raw 수집 | 워치 연동은 있어도 에르그 직결은 드묾 |
| **훈련×레이스 연결** | 훈련 실측 데이터와 공식 레이스 결과를 한 계정에서 상관 분석 | Roxlab은 레이스 사후 분석만, 훈련 앱들은 레이스 비교군 없음 |
| 한국어 우선 | 운동 DB 한/영, 현지 UX | 대부분 영어권 중심 |
| 실전 설계 | Pro Double 현역 선수의 프로그램 설계 | — |

### 1.3 타겟 사용자
- 1차: HYROX 준비 중인 한국 아마추어~경쟁 선수 (갤럭시 워치 사용자)
- 2차: Wear OS를 쓰는 글로벌 하이록스 유저
- 확장: Apple(watchOS + iPhone) 유저 — 기술 검토 완료, §9 참조

---

## 2. 3계층 아키텍처

### 2.1 계층별 역할

```
┌─────────────────────────────────────────────────────────────┐
│  워치 (Wear OS)  —  실행 계층                                  │
│  • PM5 BLE 직결(또는 폰 경유), 8런+8스테이션 타이머            │
│  • ROXZONE 트랜지션 버튼(기록 저장 + BLE 해제)                 │
│  • 실시간 vs 목표 페이스, 심박                                 │
│  • 오프라인 우선: 폰 없이 세션 완주 → 로컬 저장 → 이후 동기화  │
└───────────────────────────┬─────────────────────────────────┘
                            │ Wearable Data Layer
┌───────────────────────────▼─────────────────────────────────┐
│  폰 (Android)  —  관리/동기화 계층                            │
│  • 프로그램 계획, 운동 DB, 세션 상세 뷰/편집                   │
│  • 워치 ↔ 서버 브릿지                                         │
│  • 무거운 분석·차트·리뷰                                      │
└───────────────────────────┬─────────────────────────────────┘
                            │ REST / Realtime (HTTPS)
┌───────────────────────────▼─────────────────────────────────┐
│  온라인 사이트  —  저장/분석/커뮤니티 계층 (Source of Truth)  │
│  • 계정, 세션 영구 저장, 크로스 디바이스 동기화               │
│  • raw erg 분석 (hosub 워커가 outbound pull하여 처리)         │
│  • 레이스 분석/스플릿 비교, 리더보드, 커뮤니티                │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 기술 스택 (확정)

| 계층 | 스택 | 비고 |
|---|---|---|
| 워치 | **Kotlin + Wear Compose (네이티브)** | PM5 BLE 직결·고빈도 데이터·Tiles/저전력 때문에 사실상 강제 |
| 폰 | **Kotlin + Compose (네이티브)** | 워치가 네이티브라 Wearable Data Layer 연동 위해 네이티브로 통일 |
| 공유 모듈 | **평범한 Kotlin 모듈** | 데이터 모델·PM5 BLE 파서·동기화 로직. iOS 확장 시 KMP로 승격 |
| 온라인/서버 | **Supabase Cloud** (Auth+Postgres+Realtime+Storage) + **Next.js** (웹, Vercel) | 이 앱 전용 신규 구성 |
| 분석 워커 | **hosub 서버**(i7, Ubuntu) — 이 앱 전용 워커로 전향 | raw erg → 파생 지표 계산 (Phase 1, CPU) |
| 인증 | Supabase Auth | 이메일 + 카카오 OAuth (한국 시장 대응) |

**스택 결정 근거**
- **워치 = 네이티브 Kotlin (사실상 유일한 선택).** 이 앱의 핵심은 PM5 raw 데이터를 손목에서 직접 수신하는 것. BLE가 핵심인 앱은 단순 체크 수준을 넘으면 네이티브가 정답이며, 고빈도 스트로크 패킷에서 크로스플랫폼의 플랫폼 채널 오버헤드가 실시간 표시에 문제를 일으킴. 또한 Wear OS는 Flutter 지원이 미성숙(아이콘·location 등 호환성 이슈)해 결국 Kotlin 플랫폼 채널을 직접 짜야 함. Google도 Wear OS는 Kotlin + Jetpack Compose를 기본으로 밀고 있고 Tiles·백그라운드 센서·저전력은 네이티브에서만 제대로 동작.
- **폰 = 네이티브 Kotlin (워치가 결정).** 두 네이티브 앱 사이에서 Wearable Data Layer API가 깔끔하게 동작. 폰을 크로스플랫폼으로 하면 워치(Kotlin)와의 통신에 브릿지가 추가돼 복잡도 배가. POWER·BLOCK의 Kotlin 경험으로 학습 곡선도 낮음.
- **공유 모듈 = MVP에선 평범한 Kotlin 모듈.** iOS는 2단계로 미뤄뒀고, 서버가 source of truth라 크로스플랫폼 로직 상당수를 서버/웹이 흡수. KMP는 초반 빌드 복잡도만 얹으므로, 데이터 모델 검증 단계에선 오버헤드가 큼. iOS가 현실이 되면 그때 `:shared`를 KMP로 승격(마이그레이션 용이).

### 2.2.1 프로젝트 구조 (단일 Android Gradle 프로젝트)

```
:app     → 폰 앱 (Kotlin + Compose)
:wear    → 워치 앱 (Kotlin + Wear Compose)
:shared  → 공통 모듈 (데이터 모델, PM5 BLE 파서, 동기화 로직, API 계약)
```

- `:shared`에 BLE 파싱 로직과 세션 데이터 모델을 두어 워치·폰이 그대로 재사용
- 서버 통신 계약(API 스키마)도 `:shared`에 배치

### 2.3 핵심 동기화 원칙
1. **Source of Truth = 서버.** 세션은 워치에서 생성 → 폰 경유 → 서버 최종 저장.
2. **멱등성 보장.** 모든 세션은 클라이언트 생성 `UUID` + 생성 타임스탬프 + 소스 디바이스 태그를 가진다. 오프라인 세션이 나중에 올라와도 중복/충돌 없이 병합.
3. **워치는 폰만 본다 (MVP).** 폰→서버 동기화가 기본. 워치→서버 직접 동기화는 2단계 확장 옵션.
4. **충돌 정책 = Last-Write-Wins.** 세션은 보통 한 기기에서만 생성되므로 단순 LWW로 충분. (updated_at 기준)

### 2.4 호스팅 / 인프라 (확정)

> **원칙: 공개 프로덕션은 매니지드 클라우드, 무거운/비동기 워크로드만 개인 서버(hosub).**
> 개인 서버를 프로덕션 DB/API로 쓰면 정전·인터넷 끊김·가정용 IP 평판·보안 노출·스케일링 문제가 생김. 반면 분석은 비동기라 개인 서버로 충분.

| 영역 | 호스팅 | 비고 |
|---|---|---|
| DB + Auth + Realtime + Storage | **Supabase Cloud** | 공개 앱의 Source of Truth |
| 웹 프론트 (Next.js) | **Vercel** | 글로벌 엣지, 프론트/정적 |
| 공개 API | **Supabase Edge Functions** (기본) / 필요 시 FastAPI 추가 | 단순 CRUD는 Supabase가 흡수 |
| 분석 워커 | **hosub 서버** (i7, Ubuntu, Docker 컨테이너 격리) | Phase 1 = CPU 단순 계산, GPU 없음 |

**hosub 분석 워커 — Phase 1 기본 세팅 (확정)**

| 항목 | 확정 내용 |
|---|---|
| 역할 | 분석 워커 전용 (raw → 파생 지표). 공개 프로덕션 아님 |
| 하드웨어 | 현재 i7 그대로, GPU 없음 (Phase 1은 CPU 산술이라 충분) |
| OS/런타임 | 기존 Ubuntu 유지, 워커는 Docker 컨테이너로 격리 (기존 워크로드와 무간섭) |
| 연결 방식 | **outbound pull** (hosub → Supabase). 공유기 인바운드 포트 개방 0 |
| 실행 | 주기적 폴링/스케줄 배치로 `pending` 작업 처리 |
| 보안 | service role 키는 hosub 내부 시크릿으로만 보관 (클라이언트 절대 노출 금지) |
| 가동시간 | 비동기라 관용적 — 꺼져도 분석만 지연, 서비스는 안 멈춤 |

**분석 워커 동작 흐름 (Phase 1)**
```
1. [앱→Supabase Cloud] 세션+raw 업로드, status='pending'
2. [hosub 워커] Supabase에 pending 작업 조회 (outbound pull)
3. [hosub 워커] CPU로 파생 지표 계산 (평균/최대 파워, 페이스 곡선, 스플릿 통계)
4. [hosub→Supabase Cloud] 결과 write, status='done'
5. [웹/앱] 분석 결과 표시
```

### 2.5 Phase 로드맵

| | Phase 1 (지금) | Phase 2 (확장) |
|---|---|---|
| 분석 | raw → 파생 지표 (CPU 단순 산술) | 유지 |
| AI 코칭 | ❌ 없음 | ✅ 로컬 LLM 워크아웃/코칭 생성 |
| 분석 실행 | hosub 워커 (CPU) | hosub 워커 + GPU 승격 |
| GPU | 불필요 | 필요 (24GB VRAM급, hosub에 장착 — 물리/전력 여유 TBD) |
| 플랫폼 | Android (Wear OS + 폰) | + Apple (watchOS + iPhone) (§9) |

> **TBD(추후 검토)**: hosub의 GPU 장착 여지(PCIe 슬롯/파워/공간), 기존 hosub 워크로드와의 공존 방식(얹기 vs 전용 전향).

---

## 3. 데이터 모델

### 3.1 엔티티 관계 개요

```
users ──< programs ──< program_days ──< workout_templates
                                              │
users ──< sessions ──< session_segments ──< erg_samples (raw)
   │          │              │
   │          │              └──< segment_metrics (파생 지표)
   │          └──< (source_device, sync_status)
   │
   └──< race_results

exercises (마스터 DB, 360+) ──< workout_template_items
                            ──< session_segments (exercise_id FK)
```

### 3.2 핵심 엔티티 정의

| 엔티티 | 설명 | 핵심 필드 |
|---|---|---|
| `users` | 계정 | id, email, display_name, division, created_at |
| `exercises` | 운동 마스터 DB (360+, 한/영) | id, name_ko, name_en, equipment, station_type, media_url |
| `programs` | 훈련 프로그램 | id, user_id(or 공용), title, weeks, level |
| `program_days` | 프로그램 내 일자 | id, program_id, day_index, focus |
| `workout_templates` | 세션 설계 템플릿 | id, program_day_id, type(race_sim/wod), structure(JSONB) |
| `sessions` | 실제 수행 기록 | id(UUID), user_id, template_id, source_device, sync_status, started_at, ended_at, total_time |
| `session_segments` | 구간별 기록 (런/스테이션/ROXZONE) | id, session_id, seq, kind(run/station/roxzone), exercise_id, machine_type, split_time |
| `erg_samples` | PM5 raw 시계열 (JSONB 배열) | id, segment_id, machine_type, samples(JSONB), sample_count |
| `segment_metrics` | 파생 지표 (배치 계산) | segment_id, avg_power, max_power, avg_spm, pace_curve(JSONB), computed_at |
| `session_metrics` | 세션 단위 파생 지표 | session_id, run_lap_deviation_ms(페이싱 일관성), roxzone_total_ms, pacing_grade, computed_at |
| `race_results` | 실측 레이스 기록 | id, user_id, event, division, total_time, splits(JSONB) |
| `race_events` (2단계, S12) | 공식 대회 마스터 | id, name, location, event_date, source |
| `race_benchmarks` (2단계, S12~13) | 대회·디비전별 집계 분포 (백분위 계산용, 익명화) | event_id, division, gender, split_percentiles(JSONB), sample_count |
| `goal_plans` (2단계, S14) | 목표 시간 → 스테이션별 목표 스플릿 | id, user_id, target_time_ms, per_segment_targets(JSONB), probability_tier |

### 3.3 erg raw 데이터 저장 전략 (하이브리드)

**결정: raw는 보존, 파생은 배치로 별도 저장.**

- **원본 보존**: `erg_samples.samples` (JSONB 배열) — 세그먼트당 raw 시계열 한 덩어리로 저장. 세션 단위 로드가 빠르고 저장 효율 좋음. 백업·재분석용 원본.
- **파생 지표**: `segment_metrics` — hosub 분석 워커가 raw를 읽어 평균/최대 파워, 페이스 곡선 요약, 스트로크레이트 추이 등을 계산해 채움(Phase 1은 CPU). 크로스 세션 SQL 분석은 이 테이블 대상으로.

**PM5 Rowing 서비스 raw 필드 (샘플당)**
```
elapsed_time, distance, current_pace(/500m), stroke_rate(spm),
power(watts), calories, drive_length, drive_time,
recovery_time, peak_drive_force, avg_drive_force
```
※ machine_type(`ski`/`row`)으로 태깅해 동일 스키마에 저장. 필드 구조는 스키/로잉 거의 동일.

---

## 4. Supabase 스키마 (SQL DDL)

```sql
-- ============================================================
-- HYROX Training App — Supabase Schema
-- Postgres + Supabase Auth (auth.users 연동)
-- ============================================================

-- 확장
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- 1. 사용자 프로필 (auth.users 확장)
-- ------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  division      text check (division in ('open','pro','doubles','pro_doubles','relay')),
  gender        text,
  height_cm     numeric,
  weight_kg     numeric,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. 운동 마스터 DB (360+, 한/영)
-- ------------------------------------------------------------
create table public.exercises (
  id            uuid primary key default uuid_generate_v4(),
  name_ko       text not null,
  name_en       text not null,
  category      text,                         -- strength / running / conditioning / mobility
  equipment     text[],                       -- ['sled','kettlebell',...]
  station_type  text,                         -- hyrox 스테이션 매핑 (nullable)
  media_url     text,
  description_ko text,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3. 프로그램 / 일자 / 세션 템플릿
-- ------------------------------------------------------------
create table public.programs (
  id          uuid primary key default uuid_generate_v4(),
  owner_id    uuid references public.profiles(id) on delete cascade, -- null이면 공용 프로그램
  title       text not null,
  description text,
  weeks       int,
  level       text check (level in ('beginner','intermediate','advanced','elite')),
  is_public   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.program_days (
  id          uuid primary key default uuid_generate_v4(),
  program_id  uuid not null references public.programs(id) on delete cascade,
  day_index   int not null,                   -- 프로그램 내 순서
  focus       text,                           -- 'engine' / 'strength' / 'race_sim' ...
  notes       text
);

create table public.workout_templates (
  id             uuid primary key default uuid_generate_v4(),
  program_day_id uuid references public.program_days(id) on delete cascade,
  title          text not null,
  type           text not null check (type in ('race_sim','wod','run','strength')),
  structure      jsonb not null,              -- 세그먼트 구성(런/스테이션 순서, 목표 등)
  created_at     timestamptz not null default now()
);

create table public.workout_template_items (
  id           uuid primary key default uuid_generate_v4(),
  template_id  uuid not null references public.workout_templates(id) on delete cascade,
  seq          int not null,
  exercise_id  uuid references public.exercises(id),
  target       jsonb                          -- reps/distance/time 목표
);

-- ------------------------------------------------------------
-- 4. 세션 (실제 수행 기록) — UUID는 클라이언트 생성
-- ------------------------------------------------------------
create table public.sessions (
  id             uuid primary key,            -- 클라이언트(워치)가 생성한 UUID
  user_id        uuid not null references public.profiles(id) on delete cascade,
  template_id    uuid references public.workout_templates(id),
  source_device  text not null check (source_device in ('watch','phone','web')),
  sync_status    text not null default 'synced' check (sync_status in ('local','pending','synced')),
  started_at     timestamptz not null,
  ended_at       timestamptz,
  total_time_ms  bigint,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5. 세션 세그먼트 (런 / 스테이션 / ROXZONE)
-- ------------------------------------------------------------
create table public.session_segments (
  id            uuid primary key default uuid_generate_v4(),
  session_id    uuid not null references public.sessions(id) on delete cascade,
  seq           int not null,                 -- 세션 내 순서 (1~..)
  kind          text not null check (kind in ('run','station','roxzone')),
  exercise_id   uuid references public.exercises(id),
  machine_type  text check (machine_type in ('ski','row')), -- 에르그 종목일 때만
  split_time_ms bigint,
  started_at    timestamptz,
  ended_at      timestamptz
);

-- ------------------------------------------------------------
-- 6. erg raw 시계열 (원본 보존, JSONB 배열)
-- ------------------------------------------------------------
create table public.erg_samples (
  id            uuid primary key default uuid_generate_v4(),
  segment_id    uuid not null references public.session_segments(id) on delete cascade,
  machine_type  text not null check (machine_type in ('ski','row')),
  samples       jsonb not null,               -- [{t, dist, pace, spm, watts, cal, drive_len, ...}, ...]
  sample_count  int not null default 0,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 7. 파생 지표 (배치 계산 결과)
-- ------------------------------------------------------------
create table public.segment_metrics (
  segment_id    uuid primary key references public.session_segments(id) on delete cascade,
  avg_power     numeric,
  max_power     numeric,
  avg_spm       numeric,
  avg_pace_500  numeric,
  pace_curve    jsonb,                         -- 다운샘플된 페이스 곡선
  power_curve   jsonb,                         -- 다운샘플된 파워 곡선
  computed_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 8. 실측 레이스 기록
-- ------------------------------------------------------------
create table public.race_results (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  event        text,
  event_date   date,
  division     text,
  total_time_ms bigint,
  splits       jsonb,                          -- 스테이션별 스플릿
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 인덱스
-- ------------------------------------------------------------
create index idx_sessions_user       on public.sessions(user_id, started_at desc);
create index idx_segments_session    on public.session_segments(session_id, seq);
create index idx_ergsamples_segment  on public.erg_samples(segment_id);
create index idx_raceresults_user    on public.race_results(user_id, event_date desc);

-- ------------------------------------------------------------
-- RLS (Row Level Security) — 본인 데이터만 접근
-- ------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.sessions         enable row level security;
alter table public.session_segments enable row level security;
alter table public.erg_samples      enable row level security;
alter table public.race_results     enable row level security;

-- 예시 정책: 본인 세션만 read/write
create policy "own sessions" on public.sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- exercises / 공용 programs는 전체 읽기 허용 (별도 정책)
alter table public.exercises enable row level security;
create policy "read exercises" on public.exercises for select using (true);
```

> **주의**: 위 DDL은 초안이다. RLS 정책은 세그먼트·erg_samples가 session을 경유해 소유권을 판정하도록 조인 기반 정책을 추가로 작성해야 한다(예: `exists (select 1 from sessions s where s.id = session_id and s.user_id = auth.uid())`).

---

## 5. 온라인 사이트 기능 명세

### 5.1 MVP 범위 (1단계 — 사이트 우선)

| # | 기능 | 설명 | 우선순위 |
|---|---|---|---|
| S1 | 계정/인증 | 이메일 + 카카오 OAuth 로그인, 프로필(디비전/신체) | ★★★ |
| S2 | 데이터 모델 API | 세션 수신 엔드포인트 (UUID 멱등 업서트), 세그먼트/raw 저장 | ★★★ |
| S3 | 운동 DB 뷰어 | 360+ 운동 한/영 목록, 검색, 장비/스테이션 필터 | ★★☆ |
| S4 | 세션 히스토리 | 내 세션 목록, 상세(세그먼트별 스플릿) | ★★★ |
| S5 | raw 분석 파이프라인 | hosub 워커(CPU): raw → segment_metrics 계산 (outbound pull) | ★★☆ |
| S6 | 세션 상세 분석 | 파워/페이스 곡선 차트, 스테이션별 비교, **페이싱 일관성 지표(랩 편차)** | ★★☆ |

> S6의 페이싱 일관성(랩 편차 기반 등급)은 Roxlab이 레이스에만 적용하는 지표를 **훈련 세션부터** 제공하는 것. 파생 지표 계산(S5, hosub 워커)에 랩 편차 계산을 포함하면 추가 비용이 거의 없다.

### 5.2 2단계 (사이트 확장) — Roxlab 벤치마크 반영

> Roxlab(roxlab.app)이 검증한 레이스 분석 기능군을 흡수하되, 우리만 가진 **훈련 실측 데이터**와 연결해 상위 호환으로 만든다.

| # | 기능 | 설명 | 벤치마크 |
|---|---|---|---|
| S7 | 레이스 결과 등록/분석 | 실측 레이스 스플릿 입력, 훈련 대비 비교 | — |
| S8 | 리더보드 | 스테이션별/디비전별 순위 | — |
| S9 | 프로그램 빌더 | 공용/개인 프로그램 설계·배포 | — |
| S10 | 커뮤니티 | 세션 공유, 팔로우 | — |
| S11 | AI 워크아웃/코칭 생성 | **Phase 2**. hosub에 GPU 승격 후 로컬 LLM(Ollama)으로 맞춤 세션·코칭 생성 | Roxlab "Get a Plan"의 AI 버전 |
| **S12** | **공식 레이스 결과 통합** | 공개된 HYROX 대회 결과를 수집·정규화해 비교군 DB 구축. 사용자의 race_results와 매칭 | Roxlab의 핵심 자산 (대회당 수만 건) |
| **S13** | **백분위 퍼포먼스 랭킹** | 전체/디비전/연령대 대비 백분위 ("상위 12% vs N명"), 스테이션별 강약점 히트맵 | Roxlab "Compare" |
| **S14** | **목표 스플릿 예측기** | 목표 시간 입력 → 스테이션·런별 필요 스플릿 역산. 달성 확률 티어 제시 (예: Excellent 5% / Great 25% / Expected 50%) | Roxlab "Predict" |
| **S15** | **페이싱 일관성 지표** | 8개 런 랩 편차 기반 페이싱 등급 (예: 편차 ~9초 = Very Consistent). 훈련 세션에도 동일 지표 적용 | Roxlab "Pacing" |
| **S16** | **훈련→레이스 상관 분석** | 훈련 실측(PM5 파워, 런 페이스, ROXZONE 시간)과 레이스 결과의 상관을 시각화. "스키 평균 와트가 오르면 레이스 스키 스플릿이 어떻게 변했나" | **우리만 가능** — Roxlab엔 훈련 데이터가 없음 |
| **S17** | **레이스 시뮬 리허설 리포트** | 레이스 시뮬 세션을 실제 대회 형식으로 리포트화, 목표 스플릿(S14) 대비 실측 비교 | 훈련 실행(워치)과 분석(S14)의 결합 |

**S12 데이터 소싱 원칙**: 공개적으로 조회 가능한 대회 결과만 수집하며, 스크래핑 정책·저작권·개인정보(선수 실명) 처리 방침을 사전 검토한다. 초기에는 사용자가 본인 결과를 직접 등록(S7)하고, 비교군은 집계·익명화된 분포 통계부터 시작하는 것이 안전하다.

### 5.3 API 엔드포인트 초안 (FastAPI 또는 Supabase Edge Functions)

```
POST   /api/sessions              # 세션 업서트 (UUID 멱등)
POST   /api/sessions/{id}/segments
POST   /api/segments/{id}/erg     # raw 시계열 업로드
GET    /api/sessions?user=...     # 히스토리
GET    /api/sessions/{id}         # 상세 (세그먼트+지표 포함)
GET    /api/exercises?q=&equip=   # 운동 DB 검색
POST   /api/race-results          # 레이스 기록 등록

# --- 2단계 (Roxlab 벤치마크 기능군) ---
GET    /api/benchmarks?event=&division=      # 백분위 분포 조회 (S13)
POST   /api/goal-plans                        # 목표 시간 → 스플릿 역산 (S14)
GET    /api/users/{id}/percentile?division=   # 내 백분위 (S13)
GET    /api/users/{id}/training-race-corr     # 훈련→레이스 상관 (S16)
```

**멱등 업서트 핵심**: 세션 `id`(클라이언트 UUID)를 PK로 `ON CONFLICT (id) DO UPDATE`. 오프라인 워치 세션이 지연 도착해도 안전하게 병합.

---

## 6. 계층 간 데이터 흐름 (세션 생명주기)

```
1. [워치] 레이스 시뮬 시작 → 세션 UUID 생성, sync_status='local'
2. [워치] 스키/로잉 PM5 2대 사전 연결 → 종목 진행 중 raw 수집
3. [워치] 트랜지션 버튼 → 세그먼트 split 저장 + 해당 PM5 BLE 해제
4. [워치] 세션 종료 → 로컬 저장 (오프라인이면 여기까지)
5. [워치→폰] 연결되면 Wearable Data Layer로 세션+세그먼트+raw 전송
6. [폰→Supabase Cloud] REST로 업로드, sync_status='synced', 분석 status='pending'
7. [hosub 워커] outbound pull로 pending 조회 → CPU 계산 → segment_metrics write (status='done')
8. [사이트] 분석 뷰에서 파워/페이스 곡선, 스테이션 비교 확인
```

---

## 7. 미해결 결정 사항 (다음 논의)

1. **RLS 조인 정책 상세** — 세그먼트·raw의 소유권 판정 정책 작성 *(→ 저장소 마이그레이션에서 구현·검증 완료, 문서 반영만 남음)*
2. **raw 다운샘플링 기준** — 곡선 차트용 다운샘플 해상도(예: 초당 1포인트로 축소)
3. **오프라인 세션 보관 한도** — 워치 로컬 저장 용량/기간 정책
4. **S12 공식 결과 수집의 법적 검토** — 스크래핑 정책, 저작권, 선수 개인정보 처리. 초기엔 본인 등록(S7) + 익명 집계 분포로 시작 권장
5. **상표 출원 전 정밀 검색** — Roxlogy에 대해 KIPRIS + 주요 시장 상표 DB 전문 검토 (§10.1)

### 7.1 해결된 결정 (이력)
- ✅ **워치/폰 기술 스택** — 워치·폰 모두 네이티브 Kotlin, 공유 모듈은 평범한 Kotlin(iOS 확장 시 KMP 승격). 상세는 2.2 참조.
- ✅ **erg 데이터 저장 방식** — raw는 JSONB 원본 보존 + 파생 지표 배치 계산(하이브리드). 상세는 3.3 참조.
- ✅ **MVP 시작 계층** — 온라인 사이트 우선(계정/서버/데이터 모델 토대).
- ✅ **동기화 충돌 정책** — Last-Write-Wins. 상세는 2.3 참조.
- ✅ **프로젝트 독립성** — 다른 프로젝트와 자산·인프라 공유 없는 독립 프로젝트로 확정.
- ✅ **호스팅** — Vercel(웹) + Supabase Cloud(DB/Auth) + hosub(분석 워커). 상세는 2.4 참조.
- ✅ **분석 서버** — 운영 중인 hosub(i7)을 이 앱 전용 분석 워커로 전향, outbound pull 방식. 상세는 2.4 참조.
- ✅ **Phase 분리** — Phase 1은 단순 수치 계산(CPU), AI 코칭·GPU는 Phase 2. 상세는 2.5 참조.
- ✅ **Apple 확장 가능성** — watchOS도 PM5 직접 BLE 연결 가능(포그라운드+HKWorkoutSession 설계). Phase 2 이후 KMP 승격으로 착수. 상세는 §9 참조.
- ✅ **브랜드명 = Roxlogy** — 후보 9종 조사 끝에 확정. 도메인·패키지 체계, 톤 포함 상세는 §10 참조.
- ✅ **로고 = v4 링 시스템** — 옐로 8세그먼트(최외곽) + 블루 연속 트랙(안쪽) + 인더스트리얼 R(중앙). R 커스텀 변형은 전면 취소. 상세는 §10.4 참조.

### 7.2 GPU/hosub 확장 TBD (추후 검토)
- hosub의 GPU 장착 여지: PCIe x16 슬롯, 파워서플라이 용량(24GB급 GPU는 750~850W+ 권장), 케이스 공간
- 기존 hosub 워크로드와의 공존: 다른 프로젝트 위에 얹을지 vs 이 앱 전용으로 비우고 전향할지
- 시스템 RAM: 로컬 LLM 구동 시 32GB+ 권장 (Phase 1 분석만이면 16GB로 충분)

---

## 8. 다음 단계 제안

1. 이 문서를 프로젝트 저장소 `CLAUDE.md` 토대로 배치
2. Supabase Cloud 프로젝트 신규 생성 → 위 DDL 적용 → RLS 정책 보완
3. 운동 DB(360+, 한/영) 신규 구축 (이 앱 전용, 독립 소싱)
4. 세션 수신 API + 멱등 업서트 구현 (S2) — Supabase Edge Functions 우선
5. 세션 히스토리/상세 웹 화면 (S4) → 최소 동작 확인
6. hosub 분석 워커 전향 + outbound pull 파이프라인 연결 (S5)

---

## 9. Apple (watchOS + iPhone) 확장 — 기술 검토

> **결론: 기술적으로 가능하다.** 애플워치도 Core Bluetooth의 central 역할을 지원해 PM5에 직접 BLE 연결할 수 있다. 다만 watchOS 특유의 백그라운드 제약이 있어 설계 시 유의가 필요하다.

### 9.1 핵심 관문 — watchOS가 PM5에 직접 붙을 수 있는가? → **가능**

- **Core Bluetooth는 watchOS 4.0+에서 지원**되며, watchOS 앱은 central로서 커스텀 BLE 페리페럴(PM5)에 직접 연결해 GATT 특성을 read/notify 할 수 있다. 즉 "워치만 차고 에르그 잡는" 경험이 Apple에서도 성립한다.
- 이는 Android(Wear OS)에서 세운 핵심 차별점이 Apple로도 이어진다는 뜻.

### 9.2 watchOS BLE 제약 (설계 시 반드시 반영)

1. **포그라운드/운동 세션 중심으로 설계해야 함.** watchOS의 백그라운드 BLE 런타임은 엄격히 제한된다(백그라운드 이벤트 처리 횟수 제한, 사용자 상호작용 시 리셋). 다만 우리 시나리오는 **훈련 중 화면이 깨어 있는 포그라운드**라 문제가 작다.
2. **HKWorkoutSession을 함께 띄운다.** 운동 세션을 시작하면 앱이 훈련 내내 살아있어 BLE 수집이 안정적이고, 팔을 내려 화면이 dim 돼도 스캔/수집이 이어진다. HealthKit 심박 연동도 자연스럽게 딸려온다.
3. **재연결 지연.** 과거 사례상 워치의 BLE 재연결이 iPhone보다 느릴 수 있다(수 초 단위). → 레이스 시뮬 전 두 에르그를 **사전 연결**해두는 우리 설계(§6)가 이 제약을 이미 완화.
4. **iOS 26+ 개선.** Live Activity를 켜면 백그라운드에서도 포그라운드에 준하는 BLE 권한이 유지되는 등 최신 OS에서 제약이 완화되는 흐름. (실제 지원 범위는 구현 시점 재확인 필요)

### 9.3 Apple 확장 기술 스택

| 계층 | 스택 | 비고 |
|---|---|---|
| iPhone 앱 | **Swift + SwiftUI** + Core Bluetooth | Core Bluetooth는 iOS에서 성숙, PM5 연동 무리 없음 |
| Apple Watch 앱 | **Swift + SwiftUI (watchOS)** + Core Bluetooth + **HealthKit(HKWorkoutSession)** | 워치가 BLE central, 운동 세션으로 상시 구동 |
| 워치 ↔ iPhone | **WatchConnectivity** 프레임워크 | Android의 Wearable Data Layer에 대응 |
| 공유 비즈니스 로직 | **Kotlin Multiplatform(KMP)로 `:shared` 승격** | 데이터 모델·PM5 파싱·동기화 로직을 Android와 공유, UI만 네이티브 |
| 서버/DB | **변경 없음** (Supabase Cloud + REST) | 서버는 플랫폼 무관 — 같은 백엔드에 Apple 클라이언트만 추가 |

### 9.4 코드 공유 전략 — KMP 승격

- Phase 1에서 `:shared`를 **평범한 Kotlin 모듈**로 두었기 때문에(§2.2), Apple 확장 시 이를 **KMP로 승격**하면 데이터 모델, PM5 BLE 파싱 규칙, 동기화/멱등 로직을 iOS와 그대로 공유할 수 있다.
- **UI는 각 플랫폼 네이티브**로: Android는 Compose, Apple은 SwiftUI. 비즈니스 로직만 공유하고 UI는 네이티브로 두는 것이 각 플랫폼의 BLE/워치 특성을 살리는 최선.
- **서버가 Source of Truth**라 크로스플랫폼 동기화의 상당 부분을 백엔드가 흡수 → Apple 클라이언트는 "같은 API를 부르는 또 하나의 클라이언트"가 된다. 이 구조 덕에 Apple 확장 비용이 예측 가능.

### 9.5 리스크·공수 평가

| 항목 | 평가 |
|---|---|
| PM5 직접 연동 (워치) | 가능. 단 포그라운드+HKWorkoutSession 설계 강제 |
| 백그라운드 상시 수집 | 제약 있음 → 훈련 중 포그라운드 시나리오로 회피 |
| 코드 재사용 | KMP 승격 시 로직 공유 양호, UI는 신규 작성 필요 |
| 서버 변경 | 없음 (플랫폼 무관 설계의 이점) |
| 권장 시점 | **Phase 2 이후** — Android(Wear OS+폰)로 핵심 검증을 끝낸 뒤 착수 |

### 9.6 권장 순서

1. Phase 1: Android(Wear OS + 폰) + 웹 + hosub 워커로 **핵심 가치·데이터 모델·PM5 연동을 완전히 검증**
2. 검증 완료 후 `:shared`를 **KMP로 승격**
3. iPhone 앱(SwiftUI + Core Bluetooth) → Apple Watch 앱(watchOS + HKWorkoutSession) 순으로 확장
4. 서버·데이터 모델은 그대로 재사용 (변경 없음)

---

## 10. 브랜딩

### 10.1 브랜드명 — **Roxlogy** (확정)

- **구성**: Rox(HYROX 연상) + -logy(그리스어 "~학, ~연구") = **"하이브리드 레이스를 연구하는 학문"**
- **발음**: 록솔로지 / ROX-ol-o-jee
- **정체성 부합**: 이 앱의 승부수인 "훈련 실측 × 레이스 분석"을 이름이 직접 담는다. 훈련 도구(워치)부터 분석 플랫폼(웹)까지 제품 전체를 포괄.

**확정 근거 (네이밍 조사 이력)**
| 후보 | 결과 | 사유 |
|---|---|---|
| Roxa | ❌ | 이탈리아 스키부츠 브랜드(1992~), 스포츠 인접 업종, roxa.com 선점 |
| Cadence | ❌ | 동명 피트니스 앱 3~4개 존재, 직접 경쟁 |
| Ergo | ❌ | 로잉머신 일반명사, 상표 보호 불가, Concept2 상표 인접 |
| Hylab | ❌ | HyLab Coach 앱 스토어 존재, 다업종 다수 선점 |
| Roxlab | ❌ | **roxlab.app — 동일 컨셉의 HYROX 분석 서비스 선점** (→ 벤치마크로 전환, §1.1) |
| Roxon | ❌ | 광산장비·멀티툴·의료기기 3개 사 선점 |
| Roxmet | ✅ 가능 | 안전하나 차별성에서 Roxlogy에 밀림 (예비 후보로 보존) |
| Hyrodock | ✅ 가능 | 깨끗하나 분석 플랫폼 정체성이 약함 (예비 후보로 보존) |
| **Roxlogy** | ✅ **확정** | 검색 결과 직접 일치 0건. 연상+분석 정체성+소유 가능성 모두 충족 |

> ⚠️ 정식 출시 전 **상표 출원 전 정밀 검색**(KIPRIS 한국 + 주요 시장 상표 DB, Nice 분류 9류/41류/42류)을 전문가 검토로 수행할 것. 본 조사는 웹 검색 기반 1차 스크리닝이다.

### 10.2 네이밍 체계

| 용도 | 값 |
|---|---|
| 서비스명 | Roxlogy |
| 도메인 (1순위) | `roxlogy.app` (웹), `roxlogy.com` 확보 시도 |
| Android 패키지 | `app.roxlogy.android` (폰) / `app.roxlogy.wear` (워치) |
| iOS 번들 (Phase 2+) | `app.roxlogy.ios` / `app.roxlogy.watch` |
| GitHub 저장소 | `roxlogy` (모노레포) |
| SNS 핸들 | @roxlogy (통일) |

- 도메인·핸들은 **확정 즉시 선점 등록**할 것 (이름 노출 전에).
- 앱 스토어 표기: "Roxlogy — Hybrid Race Lab" 류의 서브타이틀로 기능 전달. **"HYROX" 상표는 앱 이름·서브타이틀에 사용 금지**, 스토어 설명문 내 지칭은 nominative fair use 범위(호환성 언급)로 제한하고 출시 전 재검토.

### 10.3 브랜드 톤 — 정밀·테크 + 담백·미니멀 (확정)

- **보이스**: 데이터가 말하게 한다. 과장·허세 없이 수치와 사실 중심. "당신의 스키 평균 파워가 3주간 8% 올랐습니다"처럼 구체적으로.
- **금지**: 하드코어 마초 클리셰("한계를 부숴라" 류), 과도한 이모지, 근거 없는 동기부여 문구.
- **한국어 우선**: UI 기본 한국어, 용어는 HYROX 커뮤니티 관용어 존중 (스테이션, 록스존, 스플릿 등 음차 유지).

### 10.4 비주얼 아이덴티티 (확정 — v4)

**마크 구조** (안쪽에서 바깥으로):
1. **중앙 R** — 심플 인더스트리얼 모노라인 (Chalk #F4F4F2, 다크 배경 기준)
2. **블루 트랙 링 (연속, 끊김 없음)** — 러닝. 선수(R)가 달리는 궤도 (Track Blue #2D7DFF)
3. **옐로 8세그먼트 링 (최외곽)** — 8개 스테이션의 프레임 (Race Yellow #FFD500)

**서사**: "선수가 트랙 위를 달리고, 그 바깥을 8개의 스테이션이 둘러싼다" — 마크가 곧 레이스의 도면.

**컬러 팔레트 (확정)**
| 이름 | 값 | 역할 |
|---|---|---|
| Race Yellow | #FFD500 | 아이덴티티/액션 (진행·기록·CTA) |
| Black | #141414 | 베이스 |
| Track Blue | #2D7DFF | 러닝/트랙 (런 진행도·페이스 라인) |
| Chalk | #F4F4F2 | 텍스트 |
| Grey | #9A9A96 | 보조 |
| Coal | #1E1E1E | 카드/표면 |

**불변 규칙**
- 옐로 링은 항상 **8조각** — 8은 레이스의 구조. UI에서 스테이션 진행도로 점등되어 살아 움직인다.
- 블루 링은 **절대 끊지 않는다** — 러닝은 연속. 항상 옐로 안쪽, 선수가 달리는 궤도.
- 옐로는 아이덴티티·액션에만, 대면적 배경은 블랙. 옐로 배경은 아이콘·배지 등 소면적 한정.
- 워드마크는 대문자 **ROXLOGY**, 헤비 산세리프(Archivo Black 계열). O를 링으로 치환한 버전은 히어로/스플래시 전용.
- HYROX 공식 로고의 서체·X 형태를 모방하지 않는다. 공유하는 것은 세계관의 색뿐.
- 최소 크기 20px 이하에서는 링 없이 R 단독.

**확정 자산** (`roxlogy-brand/` 내 v4 세트): `v4-mark-dark.svg`(프라이머리), `v4-mark-onyellow.svg`(인버스), `v4-appicon.svg`(플레이스토어), `v4-watchface.svg`(Wear OS 타일), `roxlogy-brand-v4.html`(브랜드 가이드 프리뷰)

> R 레터폼의 커스텀 변형(러너 융합 등)은 다수 탐색 후 **전면 취소** — 심플 인더스트리얼 R 유지가 최종 결정 (2026-07-05).

### 10.5 브랜드 스토리 (한 문단)

> Roxlogy는 하이브리드 레이스를 '감'이 아니라 '데이터'로 접근한다. 손목의 워치가 훈련의 모든 순간을 기록하고, 에르그의 스트로크 하나까지 raw로 남기고, 레이스 결과와 이어 붙인다. 훈련이 레이스를 어떻게 바꾸는지 — 그걸 아는 것이 Roxlogy다.
```
