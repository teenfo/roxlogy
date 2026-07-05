"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function AuthFormInner({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const supabase = createClient();

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      });
      setPending(false);
      if (error) return setError(error.message);
      // 이메일 확인이 꺼져 있으면 세션이 바로 발급된다
      if (data.session) return router.push("/dashboard");
      setNotice("확인 메일을 보냈습니다. 메일함에서 인증을 완료해 주세요.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setPending(false);
      if (error) return setError("이메일 또는 비밀번호가 올바르지 않습니다.");
      router.push(searchParams.get("next") ?? "/dashboard");
      router.refresh();
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <Link href="/">
        <Image src="/roxlogy-mark.svg" alt="Roxlogy" width={64} height={64} />
      </Link>
      <h1 className="mt-6 text-2xl font-bold">
        {mode === "login" ? "로그인" : "계정 만들기"}
      </h1>

      <form
        onSubmit={handleSubmit}
        className="mt-8 flex w-full max-w-sm flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          이메일
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          비밀번호
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-muted/30 bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent"
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-track">{notice}</p>}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-md bg-accent px-4 py-2.5 font-bold text-background hover:brightness-110 disabled:opacity-50"
        >
          {pending ? "처리 중…" : mode === "login" ? "로그인" : "가입하기"}
        </button>
      </form>

      <p className="mt-6 text-sm text-muted">
        {mode === "login" ? (
          <>
            계정이 없나요?{" "}
            <Link href="/signup" className="text-accent hover:underline">
              가입하기
            </Link>
          </>
        ) : (
          <>
            이미 계정이 있나요?{" "}
            <Link href="/login" className="text-accent hover:underline">
              로그인
            </Link>
          </>
        )}
      </p>
    </main>
  );
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  return (
    <Suspense>
      <AuthFormInner mode={mode} />
    </Suspense>
  );
}
