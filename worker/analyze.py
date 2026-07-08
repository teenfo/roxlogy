"""파생 지표 계산 — web/lib/analysis.ts 의 수식과 반드시 일치해야 한다.

세션 지표(랩 편차·페이싱 등급·록스존 합계)와 세그먼트 지표(erg raw 요약 +
곡선 다운샘플)를 계산한다. 곡선은 LTTB로 세그먼트당 최대 120포인트
(docs/API_CONTRACT.md 확정)로 줄인다.
"""
from __future__ import annotations

import math
from typing import Any

CURVE_MAX_POINTS = 120  # docs/API_CONTRACT.md


# ---------------------------------------------------------------------------
# 세션 지표 (analysis.ts 이식)
# ---------------------------------------------------------------------------
def run_lap_deviation_ms(segments: list[dict[str, Any]]) -> int | None:
    """런 랩 모표준편차(ms). 랩 2개 미만이면 None. (analysis.ts runLapDeviationMs)"""
    laps = [
        s["split_time_ms"]
        for s in segments
        if s.get("kind") == "run" and s.get("split_time_ms") is not None
    ]
    if len(laps) < 2:
        return None
    mean = sum(laps) / len(laps)
    variance = sum((l - mean) ** 2 for l in laps) / len(laps)
    return round(math.sqrt(variance))


def pacing_grade(deviation_ms: int) -> str:
    """랩 편차 → 페이싱 등급. (analysis.ts pacingGrade — 구간 일치)"""
    if deviation_ms < 10_000:
        return "very_consistent"
    if deviation_ms < 20_000:
        return "consistent"
    if deviation_ms < 35_000:
        return "variable"
    return "erratic"


def roxzone_total_ms(segments: list[dict[str, Any]]) -> int:
    return sum(
        s["split_time_ms"]
        for s in segments
        if s.get("kind") == "roxzone" and s.get("split_time_ms") is not None
    )


def session_metrics(segments: list[dict[str, Any]]) -> dict[str, Any]:
    dev = run_lap_deviation_ms(segments)
    return {
        "run_lap_deviation_ms": dev,
        "roxzone_total_ms": roxzone_total_ms(segments),
        "pacing_grade": pacing_grade(dev) if dev is not None else None,
    }


# ---------------------------------------------------------------------------
# 곡선 다운샘플 (LTTB — Largest Triangle Three Buckets)
# ---------------------------------------------------------------------------
def lttb(points: list[tuple[float, float]], threshold: int) -> list[tuple[float, float]]:
    """(x, y) 시계열을 threshold 포인트로 시각적 손실 최소화 다운샘플."""
    n = len(points)
    if threshold >= n or threshold < 3:
        return points

    sampled = [points[0]]
    bucket_size = (n - 2) / (threshold - 2)
    a = 0  # 직전 선택 인덱스

    for i in range(threshold - 2):
        # 다음 버킷의 평균점 (삼각형 세 번째 꼭짓점)
        start = math.floor((i + 1) * bucket_size) + 1
        end = min(math.floor((i + 2) * bucket_size) + 1, n)
        if end <= start:
            end = start + 1
        avg_x = sum(points[j][0] for j in range(start, min(end, n))) / (min(end, n) - start)
        avg_y = sum(points[j][1] for j in range(start, min(end, n))) / (min(end, n) - start)

        # 현재 버킷에서 삼각형 넓이 최대인 점 선택
        cur_start = math.floor(i * bucket_size) + 1
        cur_end = math.floor((i + 1) * bucket_size) + 1
        ax, ay = points[a]
        max_area = -1.0
        chosen = cur_start
        for j in range(cur_start, min(cur_end, n)):
            px, py = points[j]
            area = abs((ax - avg_x) * (py - ay) - (ax - px) * (avg_y - ay)) * 0.5
            if area > max_area:
                max_area = area
                chosen = j
        sampled.append(points[chosen])
        a = chosen

    sampled.append(points[-1])
    return sampled


# ---------------------------------------------------------------------------
# 세그먼트 지표 (erg raw 요약 + 곡선)
# ---------------------------------------------------------------------------
def _nums(samples: list[dict[str, Any]], key: str) -> list[float]:
    return [float(s[key]) for s in samples if s.get(key) is not None]


def segment_metrics(samples: list[dict[str, Any]]) -> dict[str, Any] | None:
    """erg raw 샘플 [{t,dist,pace,spm,watts,cal,...}] → 요약 + 곡선.

    샘플이 없으면 None (지표 미생성)."""
    if not samples:
        return None

    watts = _nums(samples, "watts")
    spm = _nums(samples, "spm")
    pace = _nums(samples, "pace")

    def curve(key: str) -> list[list[float]] | None:
        pts = [
            (float(s["t"]), float(s[key]))
            for s in samples
            if s.get("t") is not None and s.get(key) is not None
        ]
        if len(pts) < 2:
            return None
        ds = lttb(pts, CURVE_MAX_POINTS)
        return [[round(x, 2), round(y, 2)] for x, y in ds]

    return {
        "avg_power": round(sum(watts) / len(watts), 1) if watts else None,
        "max_power": max(watts) if watts else None,
        "avg_spm": round(sum(spm) / len(spm), 1) if spm else None,
        "avg_pace_500": round(sum(pace) / len(pace), 2) if pace else None,
        "pace_curve": curve("pace"),
        "power_curve": curve("watts"),
    }
