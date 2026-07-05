# Seed 데이터

## 운동 DB (360+, 한/영)
`exercises` 테이블 시드. Phase 1에서 이 앱 전용으로 독립 구축한다.

형식 예시 (CSV 또는 SQL insert):
- name_ko, name_en, category, equipment[], station_type, media_url, description_ko

HYROX 8 스테이션(스키에르그, 썰매 푸시/풀, 버피 브로드점프, 로잉, 파머스캐리, 런지, 월볼)은
station_type으로 태깅해 레이스 시뮬 구성에 사용.

> 시드 파일(exercises.sql 또는 exercises.csv)은 운동 DB 확정 후 추가.
