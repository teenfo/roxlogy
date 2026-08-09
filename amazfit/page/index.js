import { createWidget, widget, align, prop } from "@zos/ui";
import { getDeviceInfo } from "@zos/device";
import { setInterval, clearInterval } from "@zos/timer";
import { HeartRate } from "@zos/sensor";
import { setPageBrightTime } from "@zos/display";
import { BasePage } from "@zeppos/zml/base-page";

// Roxlogy 하이록스 시뮬 레코더 — Zepp OS(Amazfit) 1차.
// 32슬롯(런 → 록스존 → 스테이션 → 록스존 ×8)을 탭으로 진행 기록하고,
// 완료 시 app-side(폰 Zepp 앱)를 거쳐 ingest-session 으로 업로드한다.
// PM5 BLE 는 Zepp OS 제약으로 미지원(가민과 동일하게 후속 검토).

const STATIONS = [
  "SkiErg", "Sled Push", "Sled Pull", "Burpee BJ",
  "Rowing", "Farmers", "Lunges", "Wall Balls",
];

const COLOR_BG = 0x141414;
const COLOR_CHALK = 0xf4f4f2;
const COLOR_MUTED = 0x9a9a96;
const COLOR_YELLOW = 0xffd500;
const COLOR_BLUE = 0x2d7dff;
const COLOR_GOOD = 0x35c26b;
const COLOR_RED = 0xff6b6b;

// 32슬롯: (run, roxzone, station, roxzone) × 8
function slotAt(i) {
  const round = Math.floor(i / 4);
  switch (i % 4) {
    case 0: return { kind: "run", label: `RUN ${round + 1}`, color: COLOR_BLUE };
    case 1: return { kind: "roxzone", label: "ROXZONE", color: COLOR_CHALK };
    case 2: return { kind: "station", label: `S${round + 1} · ${STATIONS[round]}`, color: COLOR_YELLOW };
    default: return { kind: "roxzone", label: "ROXZONE", color: COLOR_CHALK };
  }
}

function fmt(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const two = (n) => (n < 10 ? "0" + n : "" + n);
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

function uuid4() {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

Page(
  BasePage({
    state: {
      phase: "idle", // idle | running | done | sent | error
      index: 0,
      splits: [], // { kind, ms }
      slotStart: 0,
      startedAtIso: "",
      hr: 0,
      timer: null,
    },
    widgets: {},

    build() {
      const { width, height } = getDeviceInfo();
      this.w = width;
      this.h = height;
      setPageBrightTime({ brightTime: 60000 });

      createWidget(widget.FILL_RECT, {
        x: 0, y: 0, w: width, h: height, color: COLOR_BG,
      });

      this.widgets.slot = this.text(0.14, 34, COLOR_YELLOW, "ROXLOGY");
      this.widgets.timer = this.text(0.28, 72, COLOR_CHALK, "0:00");
      this.widgets.total = this.text(0.48, 30, COLOR_MUTED, "8×1km + 8 station");
      this.widgets.hr = this.text(0.57, 30, COLOR_MUTED, "");

      this.widgets.btn = createWidget(widget.BUTTON, {
        x: Math.floor(width * 0.12),
        y: Math.floor(height * 0.68),
        w: Math.floor(width * 0.76),
        h: 84,
        radius: 42,
        normal_color: COLOR_YELLOW,
        press_color: 0xc2a300,
        color: 0x000000,
        text_size: 34,
        text: "시작",
        click_func: () => this.primary(),
      });

      this.widgets.sub = createWidget(widget.BUTTON, {
        x: Math.floor(width * 0.28),
        y: Math.floor(height * 0.68) + 96,
        w: Math.floor(width * 0.44),
        h: 56,
        radius: 28,
        normal_color: 0x2a2a2a,
        press_color: 0x1f1f1f,
        color: COLOR_CHALK,
        text_size: 24,
        text: "",
        click_func: () => this.secondary(),
      });
      this.widgets.sub.setProperty(prop.VISIBLE, false);

      this.hrSensor = new HeartRate();
      this.hrSensor.onCurrentChange(() => {
        this.state.hr = this.hrSensor.getCurrent() || 0;
      });
    },

    text(yRatio, size, color, initial) {
      return createWidget(widget.TEXT, {
        x: 0,
        y: Math.floor(this.h * yRatio),
        w: this.w,
        h: size + 14,
        color,
        text_size: size,
        align_h: align.CENTER_H,
        text: initial,
      });
    },

    primary() {
      const s = this.state;
      if (s.phase === "idle") this.startSim();
      else if (s.phase === "running") this.advance();
      else if (s.phase === "done") this.send();
      else if (s.phase === "sent" || s.phase === "error") this.reset();
    },

    secondary() {
      // done 화면의 [버리기]
      if (this.state.phase === "done") this.reset();
    },

    startSim() {
      const s = this.state;
      s.phase = "running";
      s.index = 0;
      s.splits = [];
      s.slotStart = Date.now();
      s.startedAtIso = new Date().toISOString();
      s.timer = setInterval(() => this.render(), 500);
      this.render();
    },

    advance() {
      const s = this.state;
      const now = Date.now();
      s.splits.push({ kind: slotAt(s.index).kind, ms: now - s.slotStart });
      s.slotStart = now;
      s.index += 1;
      if (s.index >= 32) {
        s.phase = "done";
        if (s.timer) { clearInterval(s.timer); s.timer = null; }
      }
      this.render();
    },

    totalMs() {
      return this.state.splits.reduce((a, x) => a + x.ms, 0);
    },

    send() {
      const s = this.state;
      const segments = s.splits.map((x, i) => ({
        seq: i + 1,
        kind: x.kind,
        split_time_ms: x.ms,
      }));
      const iso = new Date().toISOString();
      const body = {
        session: {
          id: uuid4(),
          started_at: s.startedAtIso || iso,
          client_updated_at: iso,
          source_device: "watch",
          total_time_ms: this.totalMs(),
        },
        segments,
      };
      this.widgets.btn.setProperty(prop.MORE, { text: "전송 중…" });
      this.request({ method: "UPLOAD", body })
        .then((res) => {
          s.phase = res && res.ok ? "sent" : "error";
          this.render();
        })
        .catch(() => {
          s.phase = "error";
          this.render();
        });
    },

    reset() {
      const s = this.state;
      if (s.timer) { clearInterval(s.timer); s.timer = null; }
      s.phase = "idle";
      s.index = 0;
      s.splits = [];
      this.render();
    },

    render() {
      const s = this.state;
      const W = this.widgets;
      const set = (wg, text, color) => {
        const p = { text };
        if (color !== undefined) p.color = color;
        wg.setProperty(prop.MORE, p);
      };

      if (s.phase === "idle") {
        set(W.slot, "ROXLOGY", COLOR_YELLOW);
        set(W.timer, "0:00", COLOR_CHALK);
        set(W.total, "8×1km + 8 station · 32 splits");
        set(W.hr, "탭 = 다음 구간");
        set(W.btn, "시작");
        W.sub.setProperty(prop.VISIBLE, false);
      } else if (s.phase === "running") {
        const slot = slotAt(s.index);
        set(W.slot, slot.label, slot.color);
        set(W.timer, fmt(Date.now() - s.slotStart), COLOR_CHALK);
        set(W.total, `TOTAL ${fmt(this.totalMs() + (Date.now() - s.slotStart))} · ${s.index + 1}/32`);
        set(W.hr, s.hr > 30 ? `♥ ${s.hr} bpm` : "♥ --");
        set(
          W.btn,
          slot.kind === "run" ? "1km 완료" : slot.kind === "station" ? "완료" : "다음",
        );
        W.sub.setProperty(prop.VISIBLE, false);
      } else if (s.phase === "done") {
        set(W.slot, "완료 ✓", COLOR_YELLOW);
        set(W.timer, fmt(this.totalMs()), COLOR_CHALK);
        set(W.total, "32 / 32 splits");
        set(W.hr, "");
        set(W.btn, "전송");
        set(W.sub, "버리기");
        W.sub.setProperty(prop.VISIBLE, true);
      } else if (s.phase === "sent") {
        set(W.slot, "전송됨 ✓", COLOR_GOOD);
        set(W.timer, fmt(this.totalMs()), COLOR_CHALK);
        set(W.total, "웹 세션 목록에서 확인");
        set(W.hr, "");
        set(W.btn, "새 시뮬");
        W.sub.setProperty(prop.VISIBLE, false);
      } else {
        set(W.slot, "전송 실패", COLOR_RED);
        set(W.total, "Zepp 앱 설정에서 토큰 확인");
        set(W.btn, "확인");
        W.sub.setProperty(prop.VISIBLE, false);
      }
    },

    onDestroy() {
      const s = this.state;
      if (s.timer) { clearInterval(s.timer); s.timer = null; }
      if (this.hrSensor) this.hrSensor.offCurrentChange();
    },
  }),
);
