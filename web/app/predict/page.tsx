import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PredictForm } from "@/components/predict-form";

export const metadata: Metadata = {
  title: "목표 스플릿 계산기 — Roxlogy",
  description:
    "목표 완주 시간을 입력하면 런·스테이션·트랜지션별 목표 스플릿을 역산해 드립니다.",
};

export default function PredictPage() {
  return (
    <>
      <header className="border-b border-surface">
        <nav className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/roxlogy-mark.svg" alt="" width={28} height={28} />
            <span className="text-sm font-black tracking-widest">ROXLOGY</span>
          </Link>
          <Link
            href="/login"
            className="text-sm text-muted hover:text-foreground"
          >
            로그인
          </Link>
        </nav>
      </header>
      <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <PredictForm />
      </div>
    </>
  );
}
