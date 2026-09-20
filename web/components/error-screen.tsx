"use client";

import Link from "next/link";
import Image from "next/image";
import { useSyncExternalStore } from "react";

// Error boundaries also render when the locale provider itself failed.
const messages = {
  ko: { title: "화면을 불러오지 못했어요", body: "다시 시도해 주세요. 저장한 기록은 유지됩니다.", retry: "다시 시도", home: "홈으로" },
  en: { title: "Something went wrong", body: "Please try again. Your saved records are still available.", retry: "Try again", home: "Home" },
  es: { title: "Algo salió mal", body: "Vuelve a intentarlo. Tus registros guardados siguen disponibles.", retry: "Reintentar", home: "Inicio" },
};
const subscribe = () => () => {};
export function ErrorScreen({ reset }: { reset: () => void }) {
  const lang = useSyncExternalStore(subscribe, () => document.documentElement.lang.split("-")[0], () => "en");
  const t = messages[lang as keyof typeof messages] ?? messages.en;
  return <main className="rx-state" id="main-content"><div className="rx-state-card" role="alert">
    <Image src="/roxlogy-mark-inverse.svg" alt="ROXLOGY" width={56} height={56} />
    <h1>{t.title}</h1><p>{t.body}</p>
    <div className="flex flex-wrap items-center justify-center gap-4 mt-6">
      <button type="button" onClick={reset} className="rx-primary !mt-0">{t.retry}</button>
      <Link href="/" className="text-sm underline underline-offset-4">{t.home}</Link>
    </div>
  </div></main>;
}
