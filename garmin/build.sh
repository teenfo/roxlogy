#!/usr/bin/env bash
# Roxlogy Garmin (Connect IQ) 로컬 빌드 헬퍼.
#
# 사전 준비:
#   1) Connect IQ SDK 설치 (https://developer.garmin.com/connect-iq/sdk/)
#      + SDK의 bin 디렉토리를 PATH에 추가해 `monkeyc` 가 실행되게 한다.
#   2) 최초 1회 개발자 키가 없으면 이 스크립트가 자동 생성한다.
#
# 사용:  ./build.sh [device]        # 예: ./build.sh fenix7
#        기본 device = fenix7. 지원 기기는 manifest.xml <iq:product> 참고.
#        결과: roxlogy-<device>.prg  (VS Code로 실행하거나 기기 GARMIN/APPS 에 복사)
set -euo pipefail
cd "$(dirname "$0")"

DEVICE="${1:-fenix7}"
KEY="${ROXLOGY_DEV_KEY:-developer_key.der}"

if ! command -v monkeyc >/dev/null 2>&1; then
  echo "ERROR: 'monkeyc' 를 찾을 수 없습니다. Connect IQ SDK를 설치하고 SDK/bin 을 PATH에 추가하세요." >&2
  echo "  SDK: https://developer.garmin.com/connect-iq/sdk/" >&2
  exit 1
fi

if [ ! -f "$KEY" ]; then
  echo "개발자 키가 없어 새로 생성합니다: $KEY (커밋 금지 — .gitignore 처리됨)"
  openssl genrsa -out developer_key.pem 4096
  openssl pkcs8 -topk8 -inform PEM -outform DER -in developer_key.pem -out "$KEY" -nocrypt
fi

OUT="roxlogy-${DEVICE}.prg"
echo "빌드 중: device=${DEVICE} → ${OUT}"
monkeyc -d "$DEVICE" -f monkey.jungle -o "$OUT" -y "$KEY"
echo "완료: ${OUT}"
echo "사이드로드: VS Code에서 실행하거나, ${OUT} 를 워치의 GARMIN/APPS 폴더에 복사하세요."
echo "그다음 Garmin Connect 앱 → Roxlogy 설정에서 테스트 토큰을 입력하면 업로드가 됩니다."
