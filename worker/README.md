# hosub 분석 워커 (S5)

`analysis_status='pending'` 세션을 폴링해 파생 지표(`session_metrics`,
`segment_metrics`)를 계산·저장하고 `done`으로 마킹한다.

## 원칙 (CLAUDE.md)
- **outbound pull 전용**: Supabase에 먼저 접속하는 연결만. 인바운드 포트 개방 금지.
- **service role 키는 워커 내부 시크릿으로만.** 클라이언트/프론트에 절대 노출 금지.
- 수식은 `web/lib/analysis.ts` 와 반드시 일치 (`analyze.py` 참조). 웹은 워커 결과가
  없을 때 동일 수식으로 즉석 계산해 폴백한다.

## 로컬 실행
```bash
cp .env.example .env   # SUPABASE_SERVICE_ROLE_KEY 채우기 (커밋 금지)
pip install -r requirements.txt
set -a; . ./.env; set +a
python main.py --once   # pending 1배치만 처리하고 종료 (검증용)
python main.py          # 폴링 루프 (운영)
```

## Docker (hosub 배포)
```bash
docker build -t roxlogy-worker .
docker run -d --restart unless-stopped --env-file .env --name roxlogy-worker roxlogy-worker
```

## 지표 정의
- `session_metrics`: `run_lap_deviation_ms`(런 랩 모표준편차), `roxzone_total_ms`,
  `pacing_grade`(<10s 매우일정 / <20s 일정 / <35s 기복 / else 불안정)
- `segment_metrics`: erg raw 요약(`avg_power`·`max_power`·`avg_spm`·`avg_pace_500`)
  + 곡선 `pace_curve`/`power_curve` (LTTB로 세그먼트당 ≤120pt, docs/API_CONTRACT.md)
