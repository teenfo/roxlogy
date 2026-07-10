using Toybox.Application as App;
using Toybox.WatchUi as Ui;

// Connect IQ Device App 진입점.
class RoxlogyApp extends App.AppBase {
    function initialize() {
        AppBase.initialize();
    }

    function onStart(state) {
        // 밀린 오프라인 큐 재시도.
        (new Uploader()).flush();
    }

    function getInitialView() {
        var view = new SimView();
        return [view, new SimDelegate(view)];
    }
}
