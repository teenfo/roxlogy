"""hosub 분석 워커 (S5) — outbound pull 전용.

`analysis_status='pending'` 세션을 폴링해 파생 지표를 계산·저장하고
`done`으로 마킹한다. Supabase에 먼저 접속하는 outbound 연결만 사용하며
인바운드 포트를 열지 않는다(CLAUDE.md 보안 규칙). service role 키는
환경변수로만 주입한다.

동시성/재시도:
- 세션을 'processing'으로 선점(compare-and-set)해 다중 워커 중복 처리 방지.
- 예외 시 'failed'로 마킹하고 다음 세션으로. 크래시 복구는 재시작 시
  'processing'이 오래된 것을 다시 pending으로 되돌리는 스위퍼가 담당.
"""
from __future__ import annotations

import os
import sys
import time

import httpx

from analyze import segment_metrics, session_metrics

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
POLL_INTERVAL_S = float(os.environ.get("WORKER_POLL_INTERVAL_S", "10"))
BATCH = int(os.environ.get("WORKER_BATCH", "5"))
STALE_PROCESSING_S = int(os.environ.get("WORKER_STALE_PROCESSING_S", "300"))

REST = f"{SUPABASE_URL}/rest/v1"
HEADERS = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
}


def log(msg: str) -> None:
    print(f"[worker] {msg}", flush=True)


def claim_session(client: httpx.Client, session_id: str) -> bool:
    """pending → processing compare-and-set. 성공 시 True (이 워커가 선점)."""
    r = client.patch(
        f"{REST}/sessions",
        params={
            "id": f"eq.{session_id}",
            "analysis_status": "eq.pending",
        },
        headers={**HEADERS, "Prefer": "return=representation"},
        json={"analysis_status": "processing"},
    )
    r.raise_for_status()
    return len(r.json()) > 0


def fetch_pending(client: httpx.Client) -> list[dict]:
    r = client.get(
        f"{REST}/sessions",
        params={
            "select": "id",
            "analysis_status": "eq.pending",
            "deleted_at": "is.null",
            "order": "started_at.asc",
            "limit": str(BATCH),
        },
        headers=HEADERS,
    )
    r.raise_for_status()
    return r.json()


def fetch_segments(client: httpx.Client, session_id: str) -> list[dict]:
    r = client.get(
        f"{REST}/session_segments",
        params={
            "select": "id,seq,kind,split_time_ms,erg_samples(samples)",
            "session_id": f"eq.{session_id}",
            "order": "seq.asc",
        },
        headers=HEADERS,
    )
    r.raise_for_status()
    return r.json()


def upsert(client: httpx.Client, table: str, row: dict, on_conflict: str) -> None:
    r = client.post(
        f"{REST}/{table}",
        params={"on_conflict": on_conflict},
        headers={**HEADERS, "Prefer": "resolution=merge-duplicates"},
        json=row,
    )
    r.raise_for_status()


def set_status(client: httpx.Client, session_id: str, status: str) -> None:
    r = client.patch(
        f"{REST}/sessions",
        params={"id": f"eq.{session_id}"},
        headers=HEADERS,
        json={"analysis_status": status},
    )
    r.raise_for_status()


def process(client: httpx.Client, session_id: str) -> None:
    segments = fetch_segments(client, session_id)

    # 세션 지표
    sm = session_metrics(segments)
    upsert(
        client,
        "session_metrics",
        {"session_id": session_id, **sm},
        on_conflict="session_id",
    )

    # 세그먼트 지표 (erg raw 있는 세그먼트만)
    for seg in segments:
        erg = seg.get("erg_samples")
        raw = erg[0]["samples"] if isinstance(erg, list) and erg else (
            erg.get("samples") if isinstance(erg, dict) else None
        )
        if not raw:
            continue
        gm = segment_metrics(raw)
        if gm is None:
            continue
        upsert(
            client,
            "segment_metrics",
            {"segment_id": seg["id"], **gm},
            on_conflict="segment_id",
        )

    set_status(client, session_id, "done")


def sweep_stale(client: httpx.Client) -> None:
    """오래 'processing'에 머문(크래시 잔재) 세션을 pending으로 회수."""
    cutoff = f"{STALE_PROCESSING_S} seconds"
    r = client.patch(
        f"{REST}/sessions",
        params={
            "analysis_status": "eq.processing",
            "updated_at": f"lt.now-{cutoff.replace(' ', '')}",
        },
        headers=HEADERS,
        json={"analysis_status": "pending"},
    )
    # 이 필터 문법이 배포 환경에서 안 먹으면 무시(치명적 아님)
    if r.status_code >= 400:
        log(f"sweep skipped: {r.status_code}")


def loop() -> None:
    log(f"start — poll every {POLL_INTERVAL_S}s, batch {BATCH}")
    with httpx.Client(timeout=30.0) as client:
        while True:
            try:
                for s in fetch_pending(client):
                    sid = s["id"]
                    if not claim_session(client, sid):
                        continue
                    try:
                        process(client, sid)
                        log(f"done {sid}")
                    except Exception as e:  # noqa: BLE001
                        log(f"failed {sid}: {e}")
                        try:
                            set_status(client, sid, "failed")
                        except Exception:  # noqa: BLE001
                            pass
            except Exception as e:  # noqa: BLE001
                log(f"poll error: {e}")
            time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    if "--once" in sys.argv:
        with httpx.Client(timeout=30.0) as c:
            for s in fetch_pending(c):
                if claim_session(c, s["id"]):
                    process(c, s["id"])
                    log(f"done {s['id']}")
    else:
        loop()
