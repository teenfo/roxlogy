import Image from "next/image";
import Link from "next/link";

const FEATURES = [
  {
    title: "레이스 시뮬 기록",
    body: "8런 + 8스테이션 + 트랜지션까지 세그먼트 단위로 기록하고, 워치 앱 출시 후에는 손목에서 자동으로 동기화됩니다.",
  },
  {
    title: "데이터 분석",
    body: "스플릿 분해, 런 랩 페이스 추이, 페이싱 일관성 등급까지 — 감이 아니라 데이터로 다음 훈련을 결정하세요.",
  },
  {
    title: "훈련 × 레이스",
    body: "공식 레이스 결과를 등록하면 훈련 시뮬과 스테이션별로 비교합니다. 훈련이 레이스를 어떻게 바꾸는지 확인하세요.",
  },
];

export default function Landing() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="flex flex-col items-center gap-8 px-6 pb-16 pt-24">
        <Image
          src="/roxlogy-mark.svg"
          alt="Roxlogy 마크"
          width={120}
          height={120}
          priority
        />
        <div className="text-center">
          <h1 className="text-4xl font-black tracking-widest">ROXLOGY</h1>
          <p className="mt-3 text-muted">하이브리드 레이스를 데이터로 연구하다</p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/login"
            className="rounded-md border border-muted/40 px-6 py-2.5 text-sm font-semibold hover:border-foreground"
          >
            로그인
          </Link>
          <Link
            href="/signup"
            className="rounded-md bg-accent px-6 py-2.5 text-sm font-bold text-background hover:brightness-110"
          >
            시작하기
          </Link>
        </div>
        <div className="flex gap-6 text-sm">
          <Link href="/predict" className="text-track hover:underline">
            목표 스플릿 계산기 →
          </Link>
          <Link href="/events" className="text-track hover:underline">
            대회 일정 검색 →
          </Link>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-4xl gap-4 px-6 pb-24 sm:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-md bg-surface px-5 py-5">
            <h2 className="font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
