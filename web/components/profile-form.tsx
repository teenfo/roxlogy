"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const DIVISIONS = [
  ["", "미설정"],
  ["open", "오픈"],
  ["pro", "프로"],
  ["doubles", "더블"],
  ["pro_doubles", "프로 더블"],
  ["relay", "릴레이"],
] as const;

type ProfileFields = {
  display_name: string;
  division: string;
  gender: string;
  height_cm: string;
  weight_kg: string;
};

export function ProfileForm({
  initial,
  email,
}: {
  initial: ProfileFields;
  email: string;
}) {
  const router = useRouter();
  const [fields, setFields] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function set<K extends keyof ProfileFields>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setPending(false);
      return setError("로그인이 필요합니다.");
    }

    const { error: err } = await supabase
      .from("profiles")
      .update({
        display_name: fields.display_name.trim() || null,
        division: fields.division || null,
        gender: fields.gender || null,
        height_cm: fields.height_cm ? Number(fields.height_cm) : null,
        weight_kg: fields.weight_kg ? Number(fields.weight_kg) : null,
      })
      .eq("id", user.id);

    setPending(false);
    if (err) return setError(`저장 실패: ${err.message}`);
    setSaved(true);
    router.refresh();
  }

  return (
    <main>
      <h1 className="text-2xl font-bold">프로필 설정</h1>
      <p className="mt-1 text-sm text-muted">{email}</p>

      <form onSubmit={handleSave} className="mt-6 grid max-w-md gap-4">
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          표시 이름
          <input
            value={fields.display_name}
            onChange={(e) => set("display_name", e.target.value)}
            className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
          />
        </label>

        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            디비전
            <select
              value={fields.division}
              onChange={(e) => set("division", e.target.value)}
              className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
            >
              {DIVISIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            성별
            <select
              value={fields.gender}
              onChange={(e) => set("gender", e.target.value)}
              className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
            >
              <option value="">미설정</option>
              <option value="male">남성</option>
              <option value="female">여성</option>
              <option value="other">기타</option>
            </select>
          </label>
        </div>

        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            신장 (cm)
            <input
              type="number"
              min="0"
              step="0.1"
              value={fields.height_cm}
              onChange={(e) => set("height_cm", e.target.value)}
              className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
            체중 (kg)
            <input
              type="number"
              min="0"
              step="0.1"
              value={fields.weight_kg}
              onChange={(e) => set("weight_kg", e.target.value)}
              className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
            />
          </label>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {saved && <p className="text-sm text-track">저장되었습니다.</p>}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-6 py-2.5 font-bold text-background hover:brightness-110 disabled:opacity-40"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      </form>
    </main>
  );
}
