using Toybox.Application.Storage;
using Toybox.Lang;

// 오프라인 큐 — 업로드 실패한 세션 본문(Dictionary)을 저장했다가 다음 기회에 재시도.
module Store {
    const KEY = "uploadQueue";

    function enqueue(body) {
        var q = Storage.getValue(KEY);
        if (!(q instanceof Lang.Array)) { q = []; }
        q.add(body);
        Storage.setValue(KEY, q);
    }

    function all() {
        var q = Storage.getValue(KEY);
        return (q instanceof Lang.Array) ? q : [];
    }

    function clear() {
        Storage.setValue(KEY, []);
    }

    function dropFirst() {
        var q = all();
        if (q.size() == 0) { return; }
        var n = [];
        for (var i = 1; i < q.size(); i++) { n.add(q[i]); }
        Storage.setValue(KEY, n);
    }
}
