using Toybox.BluetoothLowEnergy as Ble;
using Toybox.Lang;

// PM5(Concept2) BLE 중앙 — 커스텀 서비스 CE060030 + 상태 특성 0031/0032/0033 구독.
// 스키/로잉 스테이션에서 라이브 watts/spm/pace 보강(선택). 프레임 오프셋은 :shared C2Pm 이식.
//
// ⚠️ PM5 는 광고(advertise)에 Discovery 서비스(CE060000)만 싣는다 — Rowing(CE060030)은
// GATT 전용이라 광고 매칭에 쓰면 영영 발견되지 않는다(Wear OS v0.3.2 에서 잡은 동일 버그).
// 또한 PM5 는 모니터에서 Menu → Connect 를 눌러야 광고를 시작한다(화면 깨우기로는 불가).
// 참고: 실기기 검증 필수(시뮬레이터로 실 PM5 불가). Connect IQ SDK 컴파일 시 API 시그니처 확인 필요.
class Pm5Ble extends Ble.BleDelegate {
    var DISCOVERY;
    var SVC;
    var C0031;
    var C0032;
    var C0033;
    var CCCD;

    var device;
    var connected;
    var scanning;
    var watts;
    var spm;
    var pace;

    function initialize() {
        BleDelegate.initialize();
        DISCOVERY = Ble.stringToUuid("CE060000-43E5-11E4-916C-0800200C9A66");
        SVC   = Ble.stringToUuid("CE060030-43E5-11E4-916C-0800200C9A66");
        C0031 = Ble.stringToUuid("CE060031-43E5-11E4-916C-0800200C9A66");
        C0032 = Ble.stringToUuid("CE060032-43E5-11E4-916C-0800200C9A66");
        C0033 = Ble.stringToUuid("CE060033-43E5-11E4-916C-0800200C9A66");
        CCCD  = Ble.stringToUuid("00002902-0000-1000-8000-00805F9B34FB");
        device = null;
        connected = false;
        scanning = false;
        watts = 0;
        spm = 0;
        pace = 0.0;
    }

    function start() {
        if (scanning || connected) { return; }
        Ble.setDelegate(self);
        var profile = {
            :uuid => SVC,
            :characteristics => [
                { :uuid => C0031, :descriptors => [CCCD] },
                { :uuid => C0032, :descriptors => [CCCD] },
                { :uuid => C0033, :descriptors => [CCCD] }
            ]
        };
        Ble.registerProfile(profile);
    }

    function onProfileRegister(uuid, status) {
        scanning = true;
        Ble.setScanState(Ble.SCAN_STATE_SCANNING);
    }

    function onScanResults(scanResults) {
        for (var r = scanResults.next(); r != null; r = scanResults.next()) {
            if (isPm(r)) {
                Ble.setScanState(Ble.SCAN_STATE_OFF);
                scanning = false;
                device = Ble.pairDevice(r);
                return;
            }
        }
    }

    // PM 식별 — 광고에는 Discovery(CE060000)만 실린다. 일부 펌웨어는 서비스 UUID 를
    // 광고에 아예 싣지 않으므로 기기 이름(PM5/PM4/PM3/Concept2)도 함께 본다.
    function isPm(r) {
        var uuids = r.getServiceUuids();
        for (var u = uuids.next(); u != null; u = uuids.next()) {
            if (u.equals(DISCOVERY) || u.equals(SVC)) { return true; }
        }
        var name = r.getDeviceName();
        if (name != null) {
            if (name.find("PM5") != null || name.find("PM4") != null ||
                name.find("PM3") != null || name.find("Concept2") != null) {
                return true;
            }
        }
        return false;
    }

    function onConnectedStateChanged(dev, state) {
        if (state == Ble.CONNECTION_STATE_CONNECTED) {
            connected = true;
            device = dev;
            subscribe(C0031);
        } else {
            connected = false;
        }
    }

    function subscribe(cuuid) {
        if (device == null) { return; }
        var svc = device.getService(SVC);
        if (svc == null) { return; }
        var ch = svc.getCharacteristic(cuuid);
        if (ch == null) { return; }
        var d = ch.getDescriptor(CCCD);
        if (d != null) {
            d.requestWrite([0x01, 0x00]b); // notify 활성
        }
    }

    // CCCD write 직렬화 — 하나 끝나면 다음 특성.
    function onDescriptorWrite(descriptor, status) {
        var cuuid = descriptor.getCharacteristic().getUuid();
        if (cuuid.equals(C0031)) { subscribe(C0032); }
        else if (cuuid.equals(C0032)) { subscribe(C0033); }
    }

    function onCharacteristicChanged(ch, value) {
        var u = ch.getUuid();
        if (u.equals(C0032)) {
            if (value.size() >= 11) {
                spm = value[5] & 0xFF;
                var paceRaw = (value[7] & 0xFF) | ((value[8] & 0xFF) << 8);
                pace = paceRaw * 0.01;
                watts = wattsFromPace(pace);
            }
        } else if (u.equals(C0033)) {
            if (value.size() >= 6) {
                var w = (value[4] & 0xFF) | ((value[5] & 0xFF) << 8);
                if (watts == 0) { watts = w; }
            }
        }
    }

    // Concept2 파워↔페이스: watts = 2.80 / (m/s)^3.
    function wattsFromPace(paceSec) {
        if (paceSec <= 0.0) { return 0; }
        var mps = 500.0 / paceSec;
        return (2.80 / (mps * mps * mps)).toNumber();
    }

    function stop() {
        if (scanning) { Ble.setScanState(Ble.SCAN_STATE_OFF); scanning = false; }
        if (device != null) {
            try { Ble.unpairDevice(device); } catch (e) {}
            device = null;
        }
        connected = false;
        watts = 0;
        spm = 0;
    }
}
