using Toybox.Communications as Comm;
using Toybox.Time;
using Toybox.Time.Gregorian as Cal;
using Toybox.Math;
using Toybox.Lang;

// 시뮬 세션을 ingest-session(S2 계약)으로 업로드. anon 키(공개) + 사용자 JWT(설정 주입 테스트 토큰).
// 실패·오프라인이면 Store 오프라인 큐에 보관 → 다음 실행에서 flush()로 재시도(멱등 업서트).
class Uploader {
    var pending;

    function initialize() {
        pending = null;
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
        if ((code < 200 || code >= 300) && pending != null) {
            Store.enqueue(pending); // 실패 → 재시도 큐
        }
        pending = null;
    }

    // 앱 시작 시 밀린 큐 재시도 (첫 항목 낙관적 제거, 실패 시 onResponse가 재큐).
    function flush() {
        if (Config.token().equals("")) { return; }
        var q = Store.all();
        if (q.size() == 0) { return; }
        var first = q[0];
        Store.dropFirst();
        doSend(first);
    }

    function buildBody(engine) {
        var segs = [];
        for (var i = 0; i < engine.recordedKinds.size(); i++) {
            segs.add({
                "seq" => i + 1,
                "kind" => engine.recordedKinds[i],
                "split_time_ms" => engine.recordedSplits[i]
            });
        }
        var iso = nowIso();
        return {
            "session" => {
                "id" => makeUuid(),
                "started_at" => iso,
                "client_updated_at" => iso,
                "source_device" => "watch",
                "total_time_ms" => engine.elapsedTotal()
            },
            "segments" => segs
        };
    }

    function nowIso() {
        var info = Cal.info(Time.now(), Time.FORMAT_SHORT);
        return info.year.format("%04d") + "-" + info.month.format("%02d") + "-" +
            info.day.format("%02d") + "T" + info.hour.format("%02d") + ":" +
            info.min.format("%02d") + ":" + info.sec.format("%02d") + "Z";
    }

    function makeUuid() {
        var hex = "0123456789abcdef";
        var s = "";
        for (var i = 0; i < 32; i++) {
            if (i == 8 || i == 12 || i == 16 || i == 20) { s = s + "-"; }
            var r = Math.rand() % 16;
            s = s + hex.substring(r, r + 1);
        }
        return s;
    }
}
