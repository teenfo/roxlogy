import Image from "next/image";
import Link from "next/link";

export default function Landing() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-24">
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
    </main>
  );
}
