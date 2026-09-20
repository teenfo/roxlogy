"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMs } from "@/lib/format";
import { DIVISIONS } from "@/lib/divisions";
import {
  buildSessionRows,
  toIngestPayload,
  type IngestResult,
  raceSimTemplate,
  type SegmentForm,
} from "@/lib/session-builder";
import { TimeInput } from "@/components/time-input";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Back,
  Chip,
  Choice,
  DataTable,
  Field,
  Hint,
  NavTabs,
  PageHead,
  Panel,
} from "@/components/rox/ui";

type Row = SegmentForm & { text: string };

export type EditableSegment = {
  id: string;
  seq: number;
  kind: string;
  exercise_id: string | null;
  split_time_ms: number | null;
};

export type SessionInitial = {
  id: string;
  startedAt: string; // ISO
  segments: EditableSegment[]; // seq 순
  notes?: string | null;
  rpe?: number | null;
  templateId?: string | null;
  division?: string | null;
  raceResultId?: string | null;
  leaderboardExcluded?: boolean;
};

export type TodayWorkout = { id: string; title: string };

/** 저장된 세그먼트(빈 칸 제외·재번호됨)를 24행 템플릿에 순서대로 되맵핑 */
function rowsFromInitial(initial: SessionInitial): Row[] {
  const rows: Row[] = raceSimTemplate().map((s) => ({ ...s, text: "" }));
  let cursor = 0;
  for (const seg of initial.segments) {
    for (let i = cursor; i < rows.length; i++) {
      const r = rows[i];
      const matches =
        r.kind === seg.kind &&
        (seg.kind !== "station" || r.exerciseId === seg.exercise_id);
      if (matches) {
        if (seg.split_time_ms != null) {
          rows[i] = {
            ...r,
            splitMs: seg.split_time_ms,
            text: formatMs(seg.split_time_ms),
          };
        }
        cursor = i + 1;
        break;
      }
    }
  }
  return rows;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/**
 * 세션 기록·편집 — 시안 records.tsx 의 RecordForm 그대로 (PORT_PLAN §3-b):
 * Back · PageHead · form.rx-form-layout[Panel "01 · 기본 정보"(rx-form-grid) ·
 * Panel "02 · 구간 기록"(DataTable 라운드×런/록스존/스테이션) | aside Panel "기록 요약"].
 * 시안의 대회/시뮬 Segments 는 우리에선 별도 라우트(/races/new)라 NavTabs 로 잇는다.
 * RPE·워크아웃 연결·리더보드 제외는 시안에 없는 우리 입력(§4-1) — 01 패널 안에 둔다.
 */
export function SessionNewForm({
  initial,
  todayWorkouts = [],
  defaultDivision = null,
}: {
  initial?: SessionInitial;
  todayWorkouts?: TodayWorkout[];
  defaultDivision?: string | null;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>(() =>
    initial
      ? rowsFromInitial(initial)
      : raceSimTemplate().map((s) => ({ ...s, text: "" })),
  );
  const [startedAt, setStartedAt] = useState(() => {
    if (initial) return toLocalInput(initial.startedAt);
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [rpe, setRpe] = useState<number | null>(initial?.rpe ?? null);
  const [templateId, setTemplateId] = useState<string | null>(
    initial?.templateId ?? null,
  );
  const [division, setDivision] = useState<string>(
    initial?.division ?? defaultDivision ?? "",
  );
  const [lbExcluded, setLbExcluded] = useState<boolean>(
    initial?.leaderboardExcluded ?? false,
  );
  // 레이스 연동 세션은 폼에서 유지 (수정 시 링크 보존)
  const raceResultId = initial?.raceResultId ?? null;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const totalMs = useMemo(
    () => rows.reduce((acc, r) => acc + (r.splitMs ?? 0), 0),
    [rows],
  );

  function update(idx: number, text: string, ms: number | null) {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, text, splitMs: ms } : r)),
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // 시작 시각을 비우면 Invalid Date → toISOString() 이 던져서
    // pending 이 true 로 남아 저장 버튼이 영구 잠긴다. 먼저 검증한다.
    const startedDate = new Date(startedAt);
    if (!startedAt || Number.isNaN(startedDate.getTime()))
      return setError(t("newSession.errStartedAt"));
    setPending(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return setError(t("common.needLogin"));
    }

    const built = buildSessionRows(
      user.id,
      startedDate.toISOString(),
      rows,
      initial
        ? {
            sessionId: initial.id,
            notes,
            rpe,
            templateId,
            division: division || null,
            raceResultId,
            leaderboardExcluded: lbExcluded,
          }
        : {
            notes,
            rpe,
            templateId,
            division: division || null,
            raceResultId,
            leaderboardExcluded: lbExcluded,
          },
    );
    if ("error" in built) {
      setPending(false);
      return setError(t("newSession.errEmpty"));
    }

    // 워치·폰과 같은 진입점(ingest_session) — client_updated_at LWW 가드와
    // 세그먼트 꼬리 삭제(전체 스냅샷)를 한 트랜잭션으로 처리한다.
    const { data: res, error: rErr } = await supabase.rpc("ingest_session", {
      p: toIngestPayload(built),
    });
    if (rErr) {
      setPending(false);
      return setError(t("newSession.errSession", { msg: rErr.message }));
    }
    if (!(res as IngestResult | null)?.applied) {
      setPending(false);
      return setError(t("session.staleConflict"));
    }

    router.push(`/sessions/${built.session.id}`);
    router.refresh();
  }

  // 라운드별 행: 템플릿은 [런, 록스존, 스테이션] × 8 순서다
  const rounds = Array.from({ length: rows.length / 3 }, (_, i) => ({
    run: i * 3,
    rox: i * 3 + 1,
    station: i * 3 + 2,
  }));
  const kindLabel = [t("kind.run"), t("kind.roxzone"), t("kind.station")];
  const divisionLabel = division
    ? t(`division.${division}` as Parameters<typeof t>[0])
    : t("newSession.divisionNone");

  return (
    <>
      <Back
        href={initial ? `/sessions/${initial.id}` : "/sessions"}
        label={t("sessions.title")}
      />
      <PageHead
        title={initial ? t("newSession.editTitle") : t("newSession.title")}
        description={initial ? t("newSession.editDesc") : t("newSession.desc")}
      />
      {!initial && (
        <NavTabs
          path="/sessions/new"
          items={[
            [t("sessions.typeSim"), "/sessions/new"],
            [t("sessions.race"), "/races/new"],
          ]}
        />
      )}
      <form onSubmit={handleSave} className="rx-form-layout">
        <div>
          <Panel title={t("newSession.basics")}>
            <div className="rx-form-grid">
              <Field label={t("newSession.startTime")}>
                <Input
                  type="datetime-local"
                  required
                  value={startedAt}
                  onChange={(e) => setStartedAt(e.target.value)}
                />
              </Field>
              <Field label={t("newSession.division")}>
                {raceResultId ? (
                  <Input value={divisionLabel} readOnly />
                ) : (
                  <Choice
                    label={t("newSession.division")}
                    value={division || "__none"}
                    onChange={(v) => setDivision(v === "__none" ? "" : v)}
                    options={[
                      ["__none", t("newSession.divisionNone")],
                      ...DIVISIONS.map(
                        (d) => [d, t(`division.${d}` as Parameters<typeof t>[0])] as [string, string],
                      ),
                    ]}
                  />
                )}
              </Field>
            </div>
            {raceResultId && <Hint>{t("newSession.raceLinked")}</Hint>}
            <Field label={t("newSession.rpe")}>
              <div className="rx-actions">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <Button
                    key={n}
                    type="button"
                    size="sm"
                    variant={rpe === n ? "default" : "outline"}
                    className={rpe === n ? "rx-primary" : ""}
                    onClick={() => setRpe(rpe === n ? null : n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </Field>
            <Hint>{t("newSession.rpeHint")}</Hint>
            {todayWorkouts.length > 0 && (
              <Field label={t("newSession.linkWorkout")}>
                <div className="rx-actions">
                  {todayWorkouts.map((w) => (
                    <Button
                      key={w.id}
                      type="button"
                      size="sm"
                      variant={templateId === w.id ? "default" : "outline"}
                      className={templateId === w.id ? "rx-primary" : ""}
                      onClick={() => setTemplateId(templateId === w.id ? null : w.id)}
                    >
                      {w.title}
                    </Button>
                  ))}
                </div>
              </Field>
            )}
            <Field label={t("newSession.notes")}>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={t("newSession.notesPlaceholder")}
              />
            </Field>
            <label className="rx-check">
              <input
                type="checkbox"
                checked={lbExcluded}
                onChange={(e) => setLbExcluded(e.target.checked)}
              />
              {t("newSession.excludeLeaderboard")}
            </label>
          </Panel>
          <Panel title={t("newSession.splits")} action={<Chip>{t("newSession.optional")}</Chip>}>
            <DataTable
              headers={[t("newSession.round"), t("kind.run"), t("kind.roxzone"), t("kind.station")]}
              rows={rounds.map((r, i) => [
                <span key="s">
                  {String(i + 1).padStart(2, "0")}
                  <small className="rx-block">
                    {rows[r.station].stationKey
                      ? t(`station.${rows[r.station].stationKey}` as Parameters<typeof t>[0])
                      : ""}
                  </small>
                </span>,
                ...[r.run, r.rox, r.station].map((idx, j) => (
                  <TimeInput
                    key={idx}
                    className="rx-time-input"
                    value={rows[idx].text}
                    onChange={(text, ms) => update(idx, text, ms)}
                    placeholder="mm:ss"
                    aria-label={`${i + 1} ${kindLabel[j]}`}
                  />
                )),
              ])}
            />
            <Hint>{t("newSession.splitsHint")}</Hint>
          </Panel>
        </div>
        <aside>
          <Panel title={t("newSession.summary")}>
            <div className="rx-summary-time">{totalMs ? formatMs(totalMs) : "—:—"}</div>
            <p>
              {divisionLabel} · {startedAt.slice(0, 10)}
            </p>
            <Hint>{t("newSession.totalLabel")}</Hint>
            {error && (
              <p className="rx-error" role="alert">
                {error}
              </p>
            )}
            <Button
              className="rx-primary rx-wide"
              disabled={pending || totalMs === 0}
              type="submit"
            >
              {pending ? t("common.saving") : t("newSession.save")}
            </Button>
          </Panel>
        </aside>
      </form>
    </>
  );
}
