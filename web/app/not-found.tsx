import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-24">
      <Image src="/roxlogy-mark.svg" alt="" width={72} height={72} />
      <div className="text-center">
        <h1 className="text-2xl font-bold">페이지를 찾을 수 없습니다</h1>
        <p className="mt-2 text-sm text-muted">
          주소가 잘못되었거나 삭제된 기록일 수 있습니다.
        </p>
      </div>
      <Link
        href="/"
        className="rounded-md bg-accent px-6 py-2.5 text-sm font-bold text-background hover:brightness-110"
      >
        홈으로
      </Link>
    </main>
  );
}
