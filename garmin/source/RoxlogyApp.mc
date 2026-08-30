using Toybox.Application as App;
using Toybox.WatchUi as Ui;
using Toybox.Math;
using Toybox.Time;

// Connect IQ Device App 진입점.
class RoxlogyApp extends App.AppBase {
    function initialize() {
        AppBase.initialize();
    }

    function onStart(state) {
        // 난수 시드 — 시드하지 않으면 실행마다 같은 수열이라 세션 UUID 가 충돌하고
        // 서버가 LWW 로 이전 세션을 덮어써 흔적 없이 사라진다.
        Math.srand(Time.now().value());
        // 밀린 오프라인 큐 재시도.
        (new Uploader()).flush();
    }

    function getInitialView() {
        var view = new SimView();
        return [view, new SimDelegate(view)];
    }
}
