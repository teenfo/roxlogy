using Toybox.WatchUi as Ui;

// 탭/셀렉트로 시뮬 진행: idle→시작, running→다음 슬롯 기록, done→전송, sent→새 시뮬.
class SimDelegate extends Ui.BehaviorDelegate {
    var view;

    function initialize(v) {
        BehaviorDelegate.initialize();
        view = v;
    }

    function onTap(evt) {
        handle();
        return true;
    }

    function onSelect() {
        handle();
        return true;
    }

    function handle() {
        if (view.phase.equals("idle")) {
            view.startSim();
        } else if (view.phase.equals("running")) {
            view.advance();
        } else if (view.phase.equals("done")) {
            view.finishAndSend();
        } else {
            view.reset();
        }
    }
}
