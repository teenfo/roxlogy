"use client";

import Script from "next/script";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/site-url";

/**
 * 구글 원탭 (One Tap / FedCM).
 *
 * 리디렉트 없이 브라우저가 띄우는 "○○(으)로 계속하기" 카드로 로그인한다.
 * 공유 링크를 받고 들어온 사람이 페이지를 떠나지 않고 바로 들어올 수 있다.
 *
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID 가 없으면 아무것도 렌더링하지 않는다 —
 * 구글 콘솔 설정(승인된 JavaScript 원본) 전에 배포돼도 조용히 꺼져 있다.
 *
 * nonce: 구글에는 해시를, Supabase 에는 원문을 준다. 둘이 어긋나면
 * signInWithIdToken 이 검증에 실패한다.
 */

type Credential = { credential?: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: Record<string, unknown>) => void;
          prompt: () => void;
        };
      };
    };
  }
}

/** 원문 nonce 와 그 SHA-256(base64url) 해시를 만든다 */
async function makeNonce(): Promise<[string, string]> {
  const raw = crypto.randomUUID();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  const hashed = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return [raw, hashed];
}

export function GoogleOneTap({ next }: { next?: string }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);

  const init = useCallback(() => {
    void (async () => {
      // Script 의 onReady 는 재마운트 때 다시 불릴 수 있다 — 한 번만 띄운다
      if (started.current || !window.google || !clientId) return;
      started.current = true;

      const [raw, hashed] = await makeNonce();

      window.google.accounts.id.initialize({
      client_id: clientId,
      // 구글에는 해시된 nonce
      nonce: hashed,
      use_fedcm_for_prompt: true,
      cancel_on_tap_outside: false,
      callback: async (res: Credential) => {
        if (!res.credential) return;
        const { error } = await createClient().auth.signInWithIdToken({
          provider: "google",
          token: res.credential,
          // Supabase 에는 원문 nonce
          nonce: raw,
        });
        if (error) {
          setErr(error.message);
          return;
        }
        const to = safeNext(next ?? null);
        if (to) router.push(to);
        // 서버 컴포넌트가 새 세션으로 다시 그려져야 한다
        router.refresh();
      },
    });
      window.google.accounts.id.prompt();
    })();
  }, [clientId, next, router]);

  if (!clientId) return null;

  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onReady={init}
      />
      {/* 실패는 조용히 넘기지 않는다 — 원탭이 안 되면 아래 버튼으로 가면 된다 */}
      {err && (
        <p className="mt-2 text-xs text-danger" role="status">
          {err}
        </p>
      )}
    </>
  );
}
