using Toybox.Lang;

// 하이록스 8스테이션 (순서·키). exerciseId는 웹 시드 UUID와 일치해야 서버에서 동일 운동 매핑.
// :shared 의 Stations.kt / HyroxSim.kt 와 동일 개념을 Monkey C 로 이식.
module Stations {
    const RUN_ID = "e0000000-0000-0000-0000-000000000009";

    // 각 원소 = [key, exerciseId, machine("ski"/"row"/null)]
    function all() {
        return [
            ["ski",       "e0000000-0000-0000-0000-000000000001", "ski"],
            ["sledpush",  "e0000000-0000-0000-0000-000000000002", null],
            ["sledpull",  "e0000000-0000-0000-0000-000000000003", null],
            ["burpee",    "e0000000-0000-0000-0000-000000000004", null],
            ["row",       "e0000000-0000-0000-0000-000000000005", "row"],
            ["farmers",   "e0000000-0000-0000-0000-000000000006", null],
            ["lunges",    "e0000000-0000-0000-0000-000000000007", null],
            ["wallballs", "e0000000-0000-0000-0000-000000000008", null]
        ];
    }

    function label(key) {
        if (key == null) { return "Station"; }
        if (key.equals("ski")) { return "SkiErg"; }
        if (key.equals("sledpush")) { return "Sled Push"; }
        if (key.equals("sledpull")) { return "Sled Pull"; }
        if (key.equals("burpee")) { return "Burpee BJ"; }
        if (key.equals("row")) { return "Rowing"; }
        if (key.equals("farmers")) { return "Farmers"; }
        if (key.equals("lunges")) { return "Lunges"; }
        if (key.equals("wallballs")) { return "Wall Balls"; }
        return "Station";
    }
}

// 24슬롯의 한 칸.
class SimSlot {
    var kind;         // "run" | "roxzone" | "station"
    var exerciseId;
    var machineType;  // "ski" | "row" | null
    var stationKey;   // 스테이션이면 키, 아니면 null
    var round;        // 1..8

    function initialize(k, ex, mt, sk, r) {
        kind = k;
        exerciseId = ex;
        machineType = mt;
        stationKey = sk;
        round = r;
    }
}

// 시뮬 진행 상태기계 (순수 로직).
class SimEngine {
    var slots;
    var recordedKinds;
    var recordedSplits;
    var recordedStationKeys;
    var idx;

    function initialize() {
        slots = [];
        var st = Stations.all();
        for (var i = 0; i < st.size(); i++) {
            var n = i + 1;
            slots.add(new SimSlot("run", Stations.RUN_ID, null, null, n));
            slots.add(new SimSlot("roxzone", null, null, null, n));
            slots.add(new SimSlot("station", st[i][1], st[i][2], st[i][0], n));
        }
        recordedKinds = [];
        recordedSplits = [];
        recordedStationKeys = [];
        idx = 0;
    }

    function current() {
        return (idx < slots.size()) ? slots[idx] : null;
    }

    function isDone() {
        return idx >= slots.size();
    }

    function stationDoneCount() {
        var c = 0;
        for (var i = 0; i < recordedKinds.size(); i++) {
            if (recordedKinds[i].equals("station")) { c++; }
        }
        return c;
    }

    // 현재 슬롯이 스테이션이면 서수(0..7), 아니면 -1.
    function activeStationOrdinal() {
        var c = current();
        if (c == null) { return -1; }
        return c.kind.equals("station") ? (c.round - 1) : -1;
    }

    function record(splitMs) {
        var c = current();
        if (c == null) { return; }
        recordedKinds.add(c.kind);
        recordedSplits.add(splitMs);
        recordedStationKeys.add(c.stationKey);
        idx++;
    }

    function elapsedTotal() {
        var t = 0;
        for (var i = 0; i < recordedSplits.size(); i++) {
            t = t + recordedSplits[i];
        }
        return t;
    }
}
