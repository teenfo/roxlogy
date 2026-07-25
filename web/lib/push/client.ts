import { createClient } from "@/lib/supabase/client";
import { VAPID_PUBLIC_KEY } from "./config";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlB64ToUint8(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function register(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  return reg;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export type EnableResult = { ok: boolean; reason?: string };

export async function enablePush(): Promise<EnableResult> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: "denied" };

  const reg = await register();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8(VAPID_PUBLIC_KEY) as BufferSource,
  });
  const j = sub.toJSON();

  // 서버 등록에 실패하면 브라우저 구독도 되돌린다 — 로컬/서버 상태 불일치 방지
  const rollback = () => sub.unsubscribe().catch(() => {});

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    await rollback();
    return { ok: false, reason: "unauthorized" };
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      platform: "web",
      endpoint: j.endpoint,
      p256dh: j.keys?.p256dh,
      auth: j.keys?.auth,
      ua: navigator.userAgent,
      last_seen: new Date().toISOString(),
      disabled: false,
    },
    { onConflict: "user_id,endpoint" },
  );
  if (error) {
    await rollback();
    return { ok: false, reason: error.message };
  }
  return { ok: true };
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", user.id)
      .eq("endpoint", endpoint);
  }
}

export type TestResult = "sent" | "none" | "fail";

/**
 * 본인 기기로 테스트 알림 발송 (Edge push-send, self-test).
 * "sent"=실제 발송됨, "none"=요청은 성공했지만 0건 발송(구독 없음/서버 시크릿 미설정),
 * "fail"=요청 실패. res.ok 만 믿으면 "보냈다고 표시했는데 아무것도 안 옴"이 된다.
 */
export async function sendTest(): Promise<TestResult> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return "fail";
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/push-send`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type_key: "test",
          title: "Roxlogy",
          body: "테스트 알림입니다 🟡🔵",
          url: "/dashboard",
        }),
      },
    );
    if (!res.ok) return "fail";
    const j: { sent?: number } = await res.json().catch(() => ({}));
    return (j.sent ?? 0) > 0 ? "sent" : "none";
  } catch {
    return "fail";
  }
}
