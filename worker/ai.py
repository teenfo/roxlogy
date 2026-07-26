"""AI 인사이트 생성기 — hosub llm-gateway 경유 (Mac Ollama 백엔드).

hosub 은 성능이 낮아 LLM 추론을 같은 네트워크의 Mac 이 담당한다. 이 워커는
Supabase 큐(ai_status)를 폴링해 LLM 작업을 **llm-gateway** (/opt/hosub-mcp/llm-gateway,
기본 http://127.0.0.1:8603)로 위임한다. 게이트웨이가 역할→모델 매핑·레인 큐·재시도·
모델 설치 승인 흐름을 담당하므로 여기서는 HTTP 호출만 한다.

- 프롬프트는 이 레포 소유 (게이트웨이 roles.yaml 은 모델 정책만).
- 게이트웨이/Mac 이 죽어 있으면 조용히 보류 — 큐에 남아 다음 폴링에 재시도.
- 토큰(LLMGW_TOKEN)은 hosub .env 에만. 커밋 금지.

종류:
- session : 시뮬 세션 종료 후 구간·목표 대비 코칭 코멘트
- weekly  : 지난주(월~일, 사용자 타임존) 훈련 종합 리포트
- race    : 레이스 결과 등록 시 스플릿 분석 코멘트
"""
from __future__ import annotations

import datetime as dt
import json
import os
import time
from zoneinfo import ZoneInfo

import httpx

LLMGW_URL = os.environ.get("LLMGW_URL", "http://127.0.0.1:8603").rstrip("/")
LLMGW_TOKEN = os.environ.get("LLMGW_TOKEN", "")
# 게이트웨이 역할(roles.yaml): coach_feedback=qwen2.5:32b(고품질) / analyze_workout=14b(빠름)
AI_ROLE = os.environ.get("AI_ROLE", "coach_feedback")
AI_ENABLED = os.environ.get("AI_ENABLED", "1") == "1" and bool(LLMGW_TOKEN)
AI_BATCH = int(os.environ.get("AI_BATCH", "3"))
# generate 동기 대기(초) + pending 시 잡 폴링 추가 대기(초)
AI_WAIT_S = int(os.environ.get("AI_WAIT_S", "240"))
AI_JOB_POLL_S = int(os.environ.get("AI_JOB_POLL_S", "600"))

SYSTEM_PROMPT = (
    "너는 Roxlogy의 하이록스(HYROX) 트레이닝 코치다. 데이터를 근거로 담백하고 "
    "정확하게 말한다. 과장·허세·감탄사·이모지 금지. 한국어로 답한다. "
    "형식: 3~6문장의 분석 + 마지막에 '다음 훈련 제안: '으로 시작하는 실행 가능한 제안 1개. "
    "마크다운 헤딩 없이 평문으로. 숫자는 주어진 데이터만 사용하고 직접 계산하지 않는다 "
    "(합계·차이는 이미 계산돼 제공된다)."
)

_GW_HEADERS = {"Authorization": f"Bearer {LLMGW_TOKEN}"}


def log(msg: str) -> None:
    print(f"[ai] {msg}", flush=True)


def fmt_ms(ms) -> str:
    if ms is None:
        return "-"
    neg = int(ms) < 0
    s = abs(int(ms)) // 1000
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    body = f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"
    return f"-{body}" if neg else body


# ---------------------------------------------------------------- 게이트웨이
def gateway_available(client: httpx.Client) -> bool:
    try:
        r = client.get(f"{LLMGW_URL}/healthz", timeout=3.0)
        return r.status_code == 200
    except httpx.HTTPError:
        return False


def gw_generate(client: httpx.Client, prompt: str, metadata: dict | None = None) -> str | None:
    """게이트웨이 /v1/generate — 동기 대기 후 pending 이면 잡 폴링. 실패/보류 시 None."""
    try:
        r = client.post(
            f"{LLMGW_URL}/v1/generate",
            headers=_GW_HEADERS,
            timeout=AI_WAIT_S + 30,
            json={
                "role": AI_ROLE,
                "prompt": prompt,
                "system": SYSTEM_PROMPT,
                "wait": AI_WAIT_S,
                "metadata": metadata or {},
            },
        )
        if r.status_code == 429:
            log("게이트웨이 rate limit — 다음 사이클로 미룸")
            return None
        r.raise_for_status()
        j = r.json()
    except httpx.HTTPError as e:
        log(f"게이트웨이 호출 실패: {e}")
        return None

    if j.get("status") == "ok":
        return (j.get("response") or "").strip() or None
    if j.get("status") == "failed":
        log(f"잡 실패: {j.get('error')}")
        return None

    # pending — 모델 설치 대기·레인 정체 등. 잡은 게이트웨이에 영속되므로 폴링해 수령.
    job_id = j.get("job_id")
    if not job_id:
        return None
    deadline = time.monotonic() + AI_JOB_POLL_S
    while time.monotonic() < deadline:
        time.sleep(10)
        try:
            jr = client.get(f"{LLMGW_URL}/v1/jobs/{job_id}", headers=_GW_HEADERS, timeout=15.0).json()
        except httpx.HTTPError:
            continue
        if jr.get("status") == "ok":
            return (jr.get("response") or "").strip() or None
        if jr.get("status") == "failed":
            log(f"잡 실패 {job_id}: {jr.get('error')}")
            return None
    log(f"잡 {job_id} 장기 대기(모델 설치 승인 대기 가능성) — 이번 사이클은 보류")
    return None


# ---------------------------------------------------------------- 저장
def save_insight(
    client: httpx.Client, rest: str, headers: dict,
    user_id: str, kind: str, content: str,
    ref_id: str | None = None, period_start: str | None = None,
) -> None:
    """delete + insert 재생성 (부분 유니크 인덱스라 on_conflict 업서트 불가)."""
    params = {"user_id": f"eq.{user_id}", "kind": f"eq.{kind}"}
    if ref_id:
        params["ref_id"] = f"eq.{ref_id}"
    if period_start:
        params["period_start"] = f"eq.{period_start}"
    client.delete(f"{rest}/ai_insights", params=params, headers=headers)
    row = {
        "user_id": user_id, "kind": kind, "content": content,
        "model": f"llmgw/{AI_ROLE}", "ref_id": ref_id, "period_start": period_start,
    }
    r = client.post(f"{rest}/ai_insights", headers=headers, json=row)
    r.raise_for_status()


def set_ai_status(client: httpx.Client, rest: str, headers: dict,
                  table: str, row_id: str, status: str) -> None:
    client.patch(
        f"{rest}/{table}", params={"id": f"eq.{row_id}"},
        headers=headers, json={"ai_status": status},
    )


# ---------------------------------------------------------------- 세션 코칭
def _latest_goal(client: httpx.Client, rest: str, headers: dict, user_id: str) -> dict | None:
    r = client.get(
        f"{rest}/goal_plans",
        params={
            "select": "target_total_ms,run_total_ms,station_total_ms,roxzone_total_ms",
            "user_id": f"eq.{user_id}",
            "order": "created_at.desc", "limit": "1",
        },
        headers=headers,
    )
    rows = r.json() if r.status_code == 200 else []
    return rows[0] if rows else None


def _session_prompt(session: dict, segments: list[dict], metrics: dict | None, goal: dict | None) -> str:
    lines = [
        "다음 하이록스 시뮬 세션을 분석해 코칭 코멘트를 작성하라.",
        f"세션 일시: {session.get('started_at', '')[:16]}",
        f"총 시간: {fmt_ms(session.get('total_time_ms'))}",
        "",
        "구간 기록:",
    ]
    run_n = 0
    run_sum = 0
    station_sum = 0
    rox_sum = 0
    runs: list[int] = []
    for seg in segments:
        kind = seg.get("kind")
        ms = seg.get("split_time_ms") or 0
        split = fmt_ms(seg.get("split_time_ms"))
        if kind == "run":
            run_n += 1
            run_sum += ms
            runs.append(ms)
            lines.append(f"- 런{run_n}: {split}")
        elif kind == "station":
            ex = (seg.get("exercises") or {})
            name = ex.get("name_ko") or seg.get("machine_type") or "스테이션"
            station_sum += ms
            lines.append(f"- {name}: {split}")
        elif kind == "roxzone":
            rox_sum += ms
            lines.append(f"- 록스존: {split}")
    # 합계·최저/최고 런은 모델이 계산하지 않도록 미리 산출 (소형 모델 산술 오류 방지)
    lines += [
        "",
        f"합계(계산됨): 런 {fmt_ms(run_sum)}, 스테이션 {fmt_ms(station_sum)}, 록스존 {fmt_ms(rox_sum)}",
    ]
    if runs:
        fastest = min(runs)
        slowest = max(runs)
        lines.append(
            f"런 최속 {fmt_ms(fastest)}(런{runs.index(fastest) + 1}) / "
            f"최저 {fmt_ms(slowest)}(런{runs.index(slowest) + 1})"
        )
    if metrics:
        lines += [
            f"런 랩 편차: {fmt_ms(metrics.get('run_lap_deviation_ms'))} "
            f"(페이싱 등급: {metrics.get('pacing_grade') or '-'})",
        ]
    if goal:
        total = session.get("total_time_ms")
        lines += ["", "목표(사용자 설정) 대비 — 격차(계산됨, +는 목표보다 느림):"]
        for label, g, actual in [
            ("총시간", goal.get("target_total_ms"), total),
            ("런 합계", goal.get("run_total_ms"), run_sum),
            ("스테이션 합계", goal.get("station_total_ms"), station_sum),
            ("록스존", goal.get("roxzone_total_ms"), rox_sum),
        ]:
            if g is not None and actual is not None:
                lines.append(
                    f"- {label}: 목표 {fmt_ms(g)} / 실제 {fmt_ms(actual)} / 격차 {fmt_ms(actual - g)}"
                )
    return "\n".join(lines)


def generate_session_insights(client: httpx.Client, rest: str, headers: dict) -> int:
    r = client.get(
        f"{rest}/sessions",
        params={
            "select": "id,user_id,started_at,total_time_ms",
            "ai_status": "eq.pending",
            "analysis_status": "eq.done",  # 지표 계산이 끝난 세션만
            "deleted_at": "is.null",
            "order": "started_at.desc",
            "limit": str(AI_BATCH),
        },
        headers=headers,
    )
    r.raise_for_status()
    done = 0
    for session in r.json():
        sid, uid = session["id"], session["user_id"]
        segs = client.get(
            f"{rest}/session_segments",
            params={
                "select": "seq,kind,split_time_ms,machine_type,exercises(name_ko)",
                "session_id": f"eq.{sid}", "order": "seq.asc",
            },
            headers=headers,
        ).json()
        if not segs:
            set_ai_status(client, rest, headers, "sessions", sid, "skip")
            continue
        mrows = client.get(
            f"{rest}/session_metrics",
            params={"select": "run_lap_deviation_ms,roxzone_total_ms,pacing_grade",
                    "session_id": f"eq.{sid}"},
            headers=headers,
        ).json()
        goal = _latest_goal(client, rest, headers, uid)
        content = gw_generate(
            client,
            _session_prompt(session, segs, mrows[0] if mrows else None, goal),
            metadata={"kind": "session", "ref": sid},
        )
        if content is None:
            return done  # 게이트웨이/Mac 불가·대기 — pending 유지, 다음 사이클 재시도
        save_insight(client, rest, headers, uid, "session", content, ref_id=sid)
        set_ai_status(client, rest, headers, "sessions", sid, "done")
        log(f"session insight {sid}")
        done += 1
    return done


# ---------------------------------------------------------------- 주간 리포트
def _week_period(tz_name: str | None) -> tuple[str, str]:
    """지난주 월요일~일요일 (사용자 타임존)."""
    try:
        tz = ZoneInfo(tz_name or "UTC")
    except Exception:  # noqa: BLE001
        tz = ZoneInfo("UTC")
    today = dt.datetime.now(tz).date()
    this_monday = today - dt.timedelta(days=today.weekday())
    prev_monday = this_monday - dt.timedelta(days=7)
    return prev_monday.isoformat(), (prev_monday + dt.timedelta(days=6)).isoformat()


def generate_weekly_reports(client: httpx.Client, rest: str, headers: dict) -> int:
    """지난주에 세션이 있는 사용자 중 아직 리포트가 없는 사용자에게 생성 (멱등)."""
    # 최근 14일 세션의 사용자 목록 (규모가 커지면 RPC 로 교체)
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=14)).isoformat()
    rows = client.get(
        f"{rest}/sessions",
        params={"select": "user_id", "deleted_at": "is.null",
                "started_at": f"gte.{since}", "limit": "1000"},
        headers=headers,
    ).json()
    user_ids = sorted({r["user_id"] for r in rows})
    done = 0
    for uid in user_ids:
        prof = client.get(
            f"{rest}/profiles",
            params={"select": "timezone", "id": f"eq.{uid}"}, headers=headers,
        ).json()
        tz = prof[0].get("timezone") if prof else None
        start, end = _week_period(tz)
        exists = client.get(
            f"{rest}/ai_insights",
            params={"select": "id", "user_id": f"eq.{uid}", "kind": "eq.weekly",
                    "period_start": f"eq.{start}", "limit": "1"},
            headers=headers,
        ).json()
        if exists:
            continue
        sessions = client.get(
            f"{rest}/sessions",
            # 같은 컬럼에 gte/lte 두 조건 — PostgREST 는 반복 파라미터를 AND 로 처리
            params=[
                ("select", "id,started_at,total_time_ms,session_metrics(run_lap_deviation_ms,pacing_grade,roxzone_total_ms)"),
                ("user_id", f"eq.{uid}"),
                ("deleted_at", "is.null"),
                ("started_at", f"gte.{start}T00:00:00Z"),
                ("started_at", f"lte.{end}T23:59:59Z"),
                ("order", "started_at.asc"),
                ("limit", "50"),
            ],
            headers=headers,
        ).json()
        if not sessions:
            continue
        totals = [s.get("total_time_ms") for s in sessions if s.get("total_time_ms")]
        lines = [
            f"다음은 한 사용자의 지난주({start} ~ {end}) 하이록스 훈련 세션 목록이다. "
            "주간 훈련 리포트를 작성하라 (세션 수·페이스 추세·일관성 중심).",
            f"세션 수(계산됨): {len(sessions)}"
            + (f", 최고 기록(계산됨): {fmt_ms(min(totals))}" if totals else ""),
            "",
        ]
        for s in sessions:
            m = s.get("session_metrics") or {}
            if isinstance(m, list):
                m = m[0] if m else {}
            lines.append(
                f"- {s['started_at'][:10]}: 총 {fmt_ms(s.get('total_time_ms'))}, "
                f"런 편차 {fmt_ms(m.get('run_lap_deviation_ms'))}, "
                f"등급 {m.get('pacing_grade') or '-'}"
            )
        content = gw_generate(client, "\n".join(lines), metadata={"kind": "weekly", "ref": start})
        if content is None:
            return done
        save_insight(client, rest, headers, uid, "weekly", content, period_start=start)
        log(f"weekly report {uid} {start}")
        done += 1
    return done


# ---------------------------------------------------------------- 레이스 리포트
def generate_race_insights(client: httpx.Client, rest: str, headers: dict) -> int:
    r = client.get(
        f"{rest}/race_results",
        params={
            "select": "id,user_id,event,event_date,division,total_time_ms,splits",
            "ai_status": "eq.pending",
            "order": "created_at.desc", "limit": str(AI_BATCH),
        },
        headers=headers,
    )
    r.raise_for_status()
    done = 0
    for race in r.json():
        rid, uid = race["id"], race["user_id"]
        if not race.get("splits") and not race.get("total_time_ms"):
            set_ai_status(client, rest, headers, "race_results", rid, "skip")
            continue
        splits_json = json.dumps(race.get("splits"), ensure_ascii=False)[:3000]
        prompt = "\n".join([
            "다음 하이록스 레이스 결과를 분석해 코멘트를 작성하라 "
            "(강점 구간·약점 구간·록스존/전환 손실 중심).",
            f"대회: {race.get('event') or '-'} ({race.get('event_date') or '-'}), "
            f"디비전: {race.get('division') or '-'}",
            f"총 시간: {fmt_ms(race.get('total_time_ms'))}",
            f"스플릿 데이터(JSON, ms 단위): {splits_json}",
        ])
        content = gw_generate(client, prompt, metadata={"kind": "race", "ref": rid})
        if content is None:
            return done
        save_insight(client, rest, headers, uid, "race", content, ref_id=rid)
        set_ai_status(client, rest, headers, "race_results", rid, "done")
        log(f"race insight {rid}")
        done += 1
    return done


# ---------------------------------------------------------------- 엔트리
_last_unavailable_logged = False


def run_ai_cycle(client: httpx.Client, rest: str, headers: dict) -> None:
    """메인 루프에서 매 폴링마다 호출. 게이트웨이 불가 시 조용히 스킵(상태 변화만 로그)."""
    global _last_unavailable_logged
    if not AI_ENABLED:
        return
    if not gateway_available(client):
        if not _last_unavailable_logged:
            log(f"llm-gateway 미응답({LLMGW_URL}) — LLM 작업 보류 (지표 계산은 계속)")
            _last_unavailable_logged = True
        return
    if _last_unavailable_logged:
        log("llm-gateway 복구 — 보류된 LLM 작업 재개")
        _last_unavailable_logged = False
    try:
        generate_session_insights(client, rest, headers)
        generate_race_insights(client, rest, headers)
        generate_weekly_reports(client, rest, headers)
    except Exception as e:  # noqa: BLE001
        log(f"ai cycle error: {e}")
