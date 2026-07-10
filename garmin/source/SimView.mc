using Toybox.WatchUi as Ui;
using Toybox.Graphics as Gfx;
using Toybox.System as Sys;
using Toybox.Timer;
using Toybox.Lang;

// 두 링(바깥 옐로 8세그먼트 = 스테이션, 안쪽 블루 트랙 = 1km 러닝) + 중앙 상태 텍스트.
class SimView extends Ui.View {
    var engine;
    var phase;        // "idle" | "running" | "done" | "sent"
    var slotStartMs;
    var uiTimer;
    var uploader;     // 콜백이 GC되지 않도록 참조 보관

    function initialize() {
        View.initialize();
        engine = new SimEngine();
        phase = "idle";
        slotStartMs = 0;
        uploader = null;
    }

    function onLayout(dc) {
    }

    function onShow() {
        uiTimer = new Timer.Timer();
        uiTimer.start(method(:onTick), 250, true);
    }

    function onHide() {
        if (uiTimer != null) { uiTimer.stop(); }
    }

    function onTick() {
        Ui.requestUpdate();
    }

    function elapsedMs() {
        if (phase.equals("running")) { return Sys.getTimer() - slotStartMs; }
        return 0;
    }

    // ---- 액션 (delegate가 호출) ----
    function startSim() {
        phase = "running";
        slotStartMs = Sys.getTimer();
        Ui.requestUpdate();
    }

    function advance() {
        if (!phase.equals("running")) { return; }
        var split = Sys.getTimer() - slotStartMs;
        engine.record(split);
        if (engine.isDone()) { phase = "done"; }
        else { slotStartMs = Sys.getTimer(); }
        Ui.requestUpdate();
    }

    function finishAndSend() {
        uploader = new Uploader();
        uploader.upload(engine);
        phase = "sent";
        Ui.requestUpdate();
    }

    function reset() {
        engine = new SimEngine();
        phase = "idle";
        Ui.requestUpdate();
    }

    // 1차 러닝 진행: 5:00/km 시각 페이서. 실거리(Activity.Info)/수동 랩은 후속.
    function runProgress() {
        var c = engine.current();
        if (c == null || !c.kind.equals("run")) { return 0.0; }
        var p = elapsedMs().toFloat() / 300000.0;
        if (p > 1.0) { p = 1.0; }
        return p;
    }

    function fmt(ms) {
        var s = ms / 1000;
        if (s < 0) { s = 0; }
        var m = s / 60;
        var ss = s % 60;
        return m.format("%d") + ":" + ss.format("%02d");
    }

    function onUpdate(dc) {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        var cy = h / 2;
        dc.setColor(Gfx.COLOR_BLACK, Gfx.COLOR_BLACK);
        dc.clear();

        var minWH = (w < h) ? w : h;
        var rO = minWH / 2 - 12;
        var done = engine.stationDoneCount();
        var act = engine.activeStationOrdinal();

        // 바깥 8세그먼트
        dc.setPenWidth(10);
        for (var i = 0; i < 8; i++) {
            var startDeg = 90 - i * 45 - 4;
            var endDeg = 90 - (i + 1) * 45 + 4;
            var col = 0x2B2A12;
            if (i < done) { col = 0xFFD500; }
            else if (i == act) { col = 0x8A7A1E; }
            dc.setColor(col, Gfx.COLOR_TRANSPARENT);
            dc.drawArc(cx, cy, rO, Gfx.ARC_CLOCKWISE, startDeg, endDeg);
        }

        // 안쪽 트랙
        var rI = rO - 18;
        dc.setPenWidth(6);
        dc.setColor(0x14213F, Gfx.COLOR_TRANSPARENT);
        dc.drawArc(cx, cy, rI, Gfx.ARC_CLOCKWISE, 0, 360);
        var p = runProgress();
        if (p > 0.0) {
            dc.setColor(0x2D7DFF, Gfx.COLOR_TRANSPARENT);
            var endP = 90 - (p * 360).toNumber();
            dc.drawArc(cx, cy, rI, Gfx.ARC_CLOCKWISE, 90, endP);
        }

        // 중앙 텍스트 (기기 폰트 호환 위해 ASCII)
        dc.setColor(Gfx.COLOR_WHITE, Gfx.COLOR_TRANSPARENT);
        if (phase.equals("idle")) {
            dc.drawText(cx, cy - 14, Gfx.FONT_SMALL, "HYROX SIM", Gfx.TEXT_JUSTIFY_CENTER);
            dc.drawText(cx, cy + 12, Gfx.FONT_TINY, "TAP START", Gfx.TEXT_JUSTIFY_CENTER);
        } else if (phase.equals("done")) {
            dc.drawText(cx, cy - 16, Gfx.FONT_TINY, "DONE - TAP SEND", Gfx.TEXT_JUSTIFY_CENTER);
            dc.drawText(cx, cy + 8, Gfx.FONT_MEDIUM, fmt(engine.elapsedTotal()), Gfx.TEXT_JUSTIFY_CENTER);
        } else if (phase.equals("sent")) {
            dc.drawText(cx, cy, Gfx.FONT_SMALL, "SENT - TAP NEW", Gfx.TEXT_JUSTIFY_CENTER);
        } else {
            var c = engine.current();
            var top = "";
            var hint = "";
            if (c.kind.equals("run")) {
                top = "RUN " + c.round.format("%d");
                hint = "TAP = 1km LAP";
            } else if (c.kind.equals("roxzone")) {
                top = "ROXZONE";
                hint = "TAP = STATION";
            } else {
                top = c.round.format("%d") + " " + Stations.label(c.stationKey);
                hint = "TAP = DONE";
            }
            dc.drawText(cx, cy - 26, Gfx.FONT_TINY, top, Gfx.TEXT_JUSTIFY_CENTER);
            dc.drawText(cx, cy - 2, Gfx.FONT_MEDIUM, fmt(elapsedMs()), Gfx.TEXT_JUSTIFY_CENTER);
            dc.drawText(cx, cy + 24, Gfx.FONT_XTINY, hint, Gfx.TEXT_JUSTIFY_CENTER);
        }
    }
}
