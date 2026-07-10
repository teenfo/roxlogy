using Toybox.Communications as Comm;
using Toybox.Application as App;
using Toybox.Time;
using Toybox.Time.Gregorian as Cal;
using Toybox.Math;
using Toybox.Lang;

// 시뮬 세션을 ingest-session(S2 계약)으로 업로드. anon 키(공개) + 사용자 JWT(테스트 토큰, 설정 주입).
// service role 키 금지. 오프라인 큐/재시도·목표 diff는 후속 커밋.
class Uploader {
    // 공개 anon 키 (JWT) — RLS로 보호되어 클라이언트 포함 안전. service role 아님.
    const ANON_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
        "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1bG94YnBmaHlxa3ZnbXBta3N0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMTc0NzgsImV4cCI6MjA5ODc5MzQ3OH0." +
        "WhmfRIZWBS88_Rf-e_p7tMpOLKEX9kKxC67KVrLZGjs";
    const INGEST_URL = "https://vuloxbpfhyqkvgmpmkst.supabase.co/functions/v1/ingest-session";

    function initialize() {
    }

    function token() {
        var t = App.Properties.getValue("supabaseAccessToken");
        return (t == null) ? "" : t;
    }

    function upload(engine) {
        var tok = token();
        if (tok.equals("")) {
            // 토큰 없음 → 업로드 스킵 (오프라인 큐는 후속). 실기기에서 설정에 토큰 입력 필요.
            return;
        }

        var segs = [];
        for (var i = 0; i < engine.recordedKinds.size(); i++) {
            segs.add({
                "seq" => i + 1,
                "kind" => engine.recordedKinds[i],
                "split_time_ms" => engine.recordedSplits[i]
            });
        }

        var iso = nowIso();
        var body = {
            "session" => {
                "id" => makeUuid(),
                "started_at" => iso,
                "client_updated_at" => iso,
                "source_device" => "watch",
                "total_time_ms" => engine.elapsedTotal()
            },
            "segments" => segs
        };

        var opts = {
            :method => Comm.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Comm.REQUEST_CONTENT_TYPE_JSON,
                "apikey" => ANON_KEY,
                "Authorization" => "Bearer " + tok
            },
            :responseType => Comm.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Comm.makeWebRequest(INGEST_URL, body, opts, method(:onResponse));
    }

    function onResponse(code, data) {
        // 후속: applied 확인·재시도·오프라인 큐. 지금은 no-op.
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
