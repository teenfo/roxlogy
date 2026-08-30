using Toybox.Communications as Comm;
using Toybox.Time;
using Toybox.Time.Gregorian as Cal;
using Toybox.Math;
using Toybox.Lang;

// 시뮬 세션을 ingest-session(S2 계약)으로 업로드. anon 키(공개) + 사용자 JWT(설정 주입 테스트 토큰).
// 실패·오프라인이면 Store 오프라인 큐에 보관 → 다음 실행에서 flush()로 재시도(멱등 업서트).
class Uploader {
    var pending;
    var draining;   // 큐를 응답 콜백으로 이어 비우는 중인지

    function initialize() {
        pending = null;
        draining = false;
    }

    function upload(engine) {
        doSend(buildBody(engine));
    }

    function doSend(body) {
        if (Config.token().equals("")) {
            Store.enqueue(body); // 토큰 없으면 큐 보관
            return;
        }
        pending = body;
        var opts = {
            :method => Comm.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Comm.REQUEST_CONTENT_TYPE_JSON,
                "apikey" => Config.ANON_KEY,
                "Authorization" => "Bearer " + Config.token()
            },
            :responseType => Comm.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        Comm.makeWebRequest(Config.INGEST_URL, body, opts, method(:onResponse));
    }

    function onResponse(code, data) {
        if (pending != null) {
            // 계약(docs/API_CONTRACT.md): 4xx 는 페이로드 자체가 잘못된 영구 실패라
            // 재시도하지 않는다. 재큐하면 앱을 켤 때마다 같은 요청이 무한 반복된다.
            // (401 은 토큰 문제 — 갱신 경로가 없으므로 사용자 재설정이 필요하다)
            var permanent = (code >= 400 && code < 500);
            if ((code < 200 || code >= 300) && !permanent) {
                Store.enqueue(pending); // 일시 실패(5xx·네트워크) → 재시도 큐
            }
        }
        pending = null;
        // 밀린 큐를 응답마다 이어서 비운다 (예전엔 앱 실행당 1건만 나갔다)
        if (draining) { flushNext(); }
    }

    // 앱 시작 시 밀린 큐 재시도 — 응답 콜백이 다음 항목을 이어 보낸다.
    function flush() {
        if (Config.token().equals("")) { return; }
        draining = true;
        flushNext();
    }

    hidden function flushNext() {
        var q = Store.all();
        if (q.size() == 0) { draining = false; return; }
        var first = q[0];
        Store.dropFirst();
        doSend(first);
    }

    function buildBody(engine) {
        var segs = [];
        for (var i = 0; i < engine.recordedKinds.size(); i++) {
            var seg = {
                "seq" => i + 1,
                "kind" => engine.recordedKinds[i],
                "split_time_ms" => engine.recordedSplits[i]
            };
            // 서버가 스테이션별 분석·PR 에 잡으려면 운동 id 가 있어야 한다
            if (engine.recordedExerciseIds[i] != null) {
                seg["exercise_id"] = engine.recordedExerciseIds[i];
            }
            if (engine.recordedMachineTypes[i] != null) {
                seg["machine_type"] = engine.recordedMachineTypes[i];
            }
            segs.add(seg);
        }
        // started_at 은 시뮬 시작 시각, client_updated_at 은 전송 시각.
        // 예전엔 둘 다 업로드 시각이라 세션 날짜·시간이 종료 시각으로 저장됐다.
        var nowMoment = Time.now();
        var startMoment = (engine.startMoment != null)
            ? engine.startMoment
            : nowMoment.subtract(new Time.Duration(engine.elapsedTotal() / 1000));
        return {
            "session" => {
                "id" => makeUuid(),
                "started_at" => isoOf(startMoment),
                "client_updated_at" => isoOf(nowMoment),
                "source_device" => "watch",
                "total_time_ms" => engine.elapsedTotal()
            },
            "segments" => segs
        };
    }

    // Gregorian.info 는 기기 로컬 시각이다 — 'Z' 를 붙이려면 utcInfo 를 써야 한다.
    // (예전엔 KST 기기에서 9시간 미래의 UTC 가 만들어져 LWW 판정까지 뒤집혔다)
    function isoOf(moment) {
        var info = Cal.utcInfo(moment, Time.FORMAT_SHORT);
        return info.year.format("%04d") + "-" + info.month.format("%02d") + "-" +
            info.day.format("%02d") + "T" + info.hour.format("%02d") + ":" +
            info.min.format("%02d") + ":" + info.sec.format("%02d") + "Z";
    }

    function nowIso() {
        return isoOf(Time.now());
    }

    // Math.rand 는 시드하지 않으면 실행마다 같은 수열을 낼 수 있어 id 가 충돌한다.
    // 충돌하면 서버가 LWW 로 이전 세션을 덮어써 흔적 없이 사라진다 —
    // 앱 시작 시 srand 로 시드하고 id 앞부분에 epoch 초를 섞어 구조적으로 막는다.
    function makeUuid() {
        var hex = "0123456789abcdef";
        var secs = Time.now().value();
        var s = "";
        for (var i = 0; i < 32; i++) {
            if (i == 8 || i == 12 || i == 16 || i == 20) { s = s + "-"; }
            var r;
            if (i < 8) {
                r = (secs >> ((7 - i) * 4)) & 0x0f;  // 앞 8자리 = epoch 초(hex)
            } else if (i == 12) {
                r = 4;                                // UUID v4 버전 비트
            } else if (i == 16) {
                r = 8 + (Math.rand() % 4);            // variant 비트
            } else {
                r = Math.rand() % 16;
            }
            s = s + hex.substring(r, r + 1);
        }
        return s;
    }
}
