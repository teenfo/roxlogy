using Toybox.WatchUi as Ui;
using Toybox.Graphics as Gfx;
using Toybox.System as Sys;
using Toybox.Timer;
using Toybox.Activity;
using Toybox.ActivityRecording as Rec;
using Toybox.Lang;

// 두 링(바깥 옐로 8세그먼트 = 스테이션, 안쪽 블루 트랙 = 1km 러닝) + 중앙 상태.
// 러닝 실거리 = ActivityRecording(트레드밀) + Activity.Info.elapsedDistance(1km 자동 랩, 수동 탭 폴백).
// 목표 diff(GoalClient), PM5 라이브 보강(선택), 오프라인 큐(Uploader/Store).
class SimView extends Ui.View {
    var engine;
    var phase;          // "idle" | "running" | "done" | "sent"
    var slotStartMs;
    var slotStartDist;
    var uiTimer;
    var uploader;
    var goalClient;
    var pm5;
    var session;        // ActivityRecording session

    function initialize() {
        View.initialize();
        engine = new SimEngine();
        phase = "idle";
        slotStartMs = 0;
        slotStartDist = 0.0;
        uploader = null;
        goalClient = new GoalClient();
        pm5 = new Pm5Ble();
        session = null;
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

    function curDist() {
        var info = Activity.getActivityInfo();
        if (info != null && info.elapsedDistance != null) {
            return info.elapsedDistance;
        }
        return 0.0;
    }

    function elapsedMs() {
        if (phase.equals("running")) { return Sys.getTimer() - slotStartMs; }
        return 0;
    }

    function isErg(slot) {
        return slot != null && slot.kind.equals("station") && slot.machineType != null;
    }

    function onTick() {
        if (phase.equals("running")) {
            var c = engine.current();
            if (c != null && c.kind.equals("run") && (curDist() - slotStartDist) >= 1000.0) {
                advance(); // 트레드밀 1km 자동 랩
            }
        }
        Ui.requestUpdate();
    }

    // ---- 액션 ----
    function startSim() {
        phase = "running";
        slotStartMs = Sys.getTimer();
        goalClient.fetch();
        try {
            session = Rec.createSession({
                :name => "Roxlogy",
                :sport => Activity.SPORT_RUNNING,
                :subSport => Activity.SUB_SPORT_TREADMILL
            });
            session.start();
        } catch (e) {
            session = null;
        }
        slotStartDist = curDist();
        Ui.requestUpdate();
    }

    function advance() {
        if (!phase.equals("running")) { return; }
        var split = Sys.getTimer() - slotStartMs;
        engine.record(split);
        if (engine.isDone()) {
            phase = "done";
            pm5.stop();
        } else {
            slotStartMs = Sys.getTimer();
            slotStartDist = curDist();
            var c = engine.current();
            if (isErg(c)) { pm5.start(); } else { pm5.stop(); }
        }
        Ui.requestUpdate();
    }

    function finishAndSend() {
        stopSession();
        uploader = new Uploader();
        uploader.upload(engine); // 실패 시 오프라인 큐에 저장
        phase = "sent";
        Ui.requestUpdate();
    }

    function stopSession() {
        if (session != null) {
            try { session.stop(); session.save(); } catch (e) {}
            session = null;
        }
    }

    function reset() {
        stopSession();
        pm5.stop();
        engine = new SimEngine();
        phase = "idle";
        Ui.requestUpdate();
    }

    function runProgress() {
        var c = engine.current();
        if (c == null || !c.kind.equals("run")) { return 0.0; }
        var rd = curDist() - slotStartDist;
        var p;
        if (rd > 0.0) { p = rd / 1000.0; }
        else { p = elapsedMs().toFloat() / 300000.0; }
        if (p > 1.0) { p = 1.0; }
        return p;
    }

    function fmt(ms) {
        var s = ms / 1000;
        if (s < 0) { s = 0; }
        return (s / 60).format("%d") + ":" + (s % 60).format("%02d");
    }

    function fmtDiff(ms) {
        var a = (ms < 0 ? -ms : ms) / 1000;
        return (ms <= 0 ? "-" : "+") + (a / 60).format("%d") + ":" + (a % 60).format("%02d");
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

        var rI = rO - 18;
        dc.setPenWidth(6);
        dc.setColor(0x14213F, Gfx.COLOR_TRANSPARENT);
        dc.drawArc(cx, cy, rI, Gfx.ARC_CLOCKWISE, 0, 360);
        var p = runProgress();
        if (p > 0.0) {
            dc.setColor(0x2D7DFF, Gfx.COLOR_TRANSPARENT);
            dc.drawArc(cx, cy, rI, Gfx.ARC_CLOCKWISE, 90, 90 - (p * 360).toNumber());
        }

        dc.setColor(Gfx.COLOR_WHITE, Gfx.COLOR_TRANSPARENT);
        if (phase.equals("idle")) {
            dc.drawText(cx, cy - 14, Gfx.FONT_SMALL, "HYROX SIM", Gfx.TEXT_JUSTIFY_CENTER);
            dc.drawText(cx, cy + 12, Gfx.FONT_TINY, "TAP START", Gfx.TEXT_JUSTIFY_CENTER);
        } else if (phase.equals("done")) {
            dc.drawText(cx, cy - 16, Gfx.FONT_TINY, "DONE - TAP SEND", Gfx.TEXT_JUSTIFY_CENTER);
            dc.drawText(cx, cy + 6, Gfx.FONT_MEDIUM, fmt(engine.elapsedTotal()), Gfx.TEXT_JUSTIFY_CENTER);
            drawDiff(dc, cx, cy + 32);
        } else if (phase.equals("sent")) {
            dc.drawText(cx, cy, Gfx.FONT_SMALL, "SENT - TAP NEW", Gfx.TEXT_JUSTIFY_CENTER);
        } else {
            var c = engine.current();
            var top = "";
            var hint = "";
            if (c.kind.equals("run")) {
                top = "RUN " + c.round.format("%d");
                var rd = (curDist() - slotStartDist).toNumber();
                hint = (rd > 0) ? (rd.format("%d") + " m / 1km") : "TAP = 1km LAP";
            } else if (c.kind.equals("roxzone")) {
                top = "ROXZONE";
                hint = "TAP = STATION";
            } else {
                top = c.round.format("%d") + " " + Stations.label(c.stationKey);
                hint = isErg(c) && pm5.connected ? (pm5.watts.format("%d") + "W spm " + pm5.spm.format("%d")) : "TAP = DONE";
            }
            dc.drawText(cx, cy - 26, Gfx.FONT_TINY, top, Gfx.TEXT_JUSTIFY_CENTER);
            dc.drawText(cx, cy - 2, Gfx.FONT_MEDIUM, fmt(elapsedMs()), Gfx.TEXT_JUSTIFY_CENTER);
            dc.drawText(cx, cy + 22, Gfx.FONT_XTINY, hint, Gfx.TEXT_JUSTIFY_CENTER);
            drawDiff(dc, cx, cy + 40);
        }
    }

    function drawDiff(dc, cx, y) {
        var diff = goalClient.checkpointDiff(engine);
        if (diff == null) { return; }
        dc.setColor(diff <= 0 ? 0x35C26B : 0xFF6B6B, Gfx.COLOR_TRANSPARENT);
        dc.drawText(cx, y, Gfx.FONT_XTINY, "GOAL " + fmtDiff(diff), Gfx.TEXT_JUSTIFY_CENTER);
    }
}
