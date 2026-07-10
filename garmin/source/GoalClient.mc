using Toybox.Communications as Comm;
using Toybox.Lang;

// 웹 goal_plans(최신 1건)를 조회해 슬롯별 목표를 보관하고, 현재 누적 대비 diff(ms)를 계산.
// :shared HyroxSim.checkpointDiffMs 와 동일 개념. 토큰 없으면 조회 스킵(diff 미표시).
class GoalClient {
    var loaded;
    var runEach;
    var roxEach;
    var stEach;
    var stationTargets;

    function initialize() {
        loaded = false;
        runEach = 0;
        roxEach = 0;
        stEach = 0;
        stationTargets = {};
    }

    function fetch() {
        var tok = Config.token();
        if (tok.equals("")) { return; }
        var url = Config.GOAL_URL +
            "?select=run_total_ms,station_total_ms,roxzone_total_ms,stations" +
            "&order=created_at.desc&limit=1";
        var opts = {
            :method => Comm.HTTP_REQUEST_METHOD_GET,
            :headers => {
                "apikey" => Config.ANON_KEY,
                "Authorization" => "Bearer " + tok
            },
            :responseType => Comm.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        Comm.makeWebRequest(url, null, opts, method(:onGoal));
    }

    function onGoal(code, data) {
        if (code != 200 || !(data instanceof Lang.Array) || data.size() == 0) { return; }
        var g = data[0];
        runEach = num(g["run_total_ms"]) / 8;
        roxEach = num(g["roxzone_total_ms"]) / 8;
        stEach = num(g["station_total_ms"]) / 8;
        stationTargets = {};
        var arr = g["stations"];
        if (arr instanceof Lang.Array) {
            for (var i = 0; i < arr.size(); i++) {
                var s = arr[i];
                if (s instanceof Lang.Dictionary) {
                    stationTargets[s["key"]] = num(s["targetMs"]);
                }
            }
        }
        loaded = true;
    }

    function num(v) {
        return (v == null) ? 0 : v.toNumber();
    }

    // 완료 슬롯 기준 목표 대비 diff(ms). 음수=앞섬, 양수=뒤처짐. 미로드면 null.
    function checkpointDiff(engine) {
        if (!loaded) { return null; }
        var target = 0;
        var n = engine.recordedKinds.size();
        for (var i = 0; i < n; i++) {
            var k = engine.recordedKinds[i];
            if (k.equals("run")) {
                target = target + runEach;
            } else if (k.equals("roxzone")) {
                target = target + roxEach;
            } else {
                var key = engine.recordedStationKeys[i];
                target = target + (stationTargets.hasKey(key) ? stationTargets[key] : stEach);
            }
        }
        return engine.elapsedTotal() - target;
    }
}
