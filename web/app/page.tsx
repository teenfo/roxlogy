import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, ArrowRight, Flag, Layers, Users } from "lucide-react";
import { getCrewDirectory } from "@/lib/crew";
import { getT } from "@/lib/i18n";
import { safeNext } from "@/lib/site-url";
import { PublicHeader } from "@/components/rox/public-header";
import { Go } from "@/components/rox/ui";

/**
 * 첫 화면 — 시안 public-screens.tsx 의 Landing 그대로 (PORT_PLAN §3-a).
 * 히어로 결과 카드·데모 차트는 시안 예시 숫자를 그대로 둔다(§7-4 확정:
 * 비로그인 화면이라 실데이터가 없다). 크루 티커만 실데이터(공개 RPC).
 * 시안의 "데모 둘러보기"는 우리에 데모 계정이 없어 로그인으로, 데모 상세
 * 링크는 공개 계산기(/predict)로 간다.
 *
 * `?code=` 를 달고 들어오는 경우가 있다: Supabase 는 redirectTo 가 Redirect URL
 * 허용 목록에 없으면 조용히 Site URL(= 여기)로 보낸다. 그대로 두면 사용자는
 * 로그인이 안 된 채 첫 화면을 보게 되므로 콜백으로 넘겨 준다.
 */
export default async function Landing({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string }>;
}) {
  const { code, next } = await searchParams;
  if (code) {
    const to = safeNext(next ?? null);
    redirect(
      `/auth/callback?code=${encodeURIComponent(code)}` +
        (to ? `&next=${encodeURIComponent(to)}` : ""),
    );
  }

  // 크루 티커는 공개 RPC(crew_directory)라 비로그인에서도 그대로 내려온다.
  const [{ t }, crews] = await Promise.all([getT(), getCrewDirectory(4)]);

  const features = [
    [Activity, "landing.f.record", "landing.f.recordDesc"],
    [Layers, "landing.f.train", "landing.f.trainDesc"],
    [Users, "landing.f.crew", "landing.f.crewDesc"],
  ] as const;

  return (
    <div className="rx-public">
      <PublicHeader />
      <main>
        <section className="rx-landing-hero">
          <div>
            <span className="rx-kicker">TRAIN. TRACK. TOGETHER.</span>
            <h1>{t("landing.headline")}</h1>
            <p>{t("landing.intro")}</p>
            <div className="rx-actions">
              <Go href="/signup" primary>
                {t("landing.start")}
                <ArrowRight size={18} />
              </Go>
              <Go href="/login">{t("common.login")}</Go>
            </div>
            <small>HYBRID TRAINING · RACE ANALYTICS · CREW</small>
          </div>
          <div className="rx-landing-result">
            <div>
              <span>ROXLOGY / RACE REPORT</span>
              <Flag size={24} />
            </div>
            <p>HYROX SHENZHEN</p>
            <strong>1:39:55</strong>
            <span>PRO DOUBLES · FINISH TIME</span>
            <div className="rx-landing-splits">
              <div>
                <b>48:59</b>
                <span>RUN</span>
              </div>
              <div>
                <b>39:21</b>
                <span>STATIONS</span>
              </div>
              <div>
                <b>11:35</b>
                <span>OTHER</span>
              </div>
            </div>
            <div
              className="rx-result-bars"
              aria-label="Run 49%, stations 39.4%, other 11.6%"
            >
              <i style={{ width: "49%" }} />
              <i style={{ width: "39.4%" }} />
              <i style={{ width: "11.6%" }} />
            </div>
            <small>{t("landing.demoNote")}</small>
          </div>
        </section>

        {/* 활동 크루 — 시안의 정적 티커 자리에 실제 크루 이름 */}
        <section className="rx-crew-ticker" aria-label={t("nav.crews")}>
          <b>
            {crews.length > 0
              ? crews.map((c, i) => (
                  <span key={c.slug}>
                    {i > 0 && " · "}
                    <Link href={`/crews/${c.slug}`}>{c.name}</Link>
                  </span>
                ))
              : "ROXLOGY"}
          </b>
          <span>{t("landing.crewTicker")}</span>
          <b>
            <Link href="/crews">ROXLOGY</Link>
          </b>
        </section>

        <section className="rx-landing-demo">
          <div>
            <span className="rx-kicker">THE NEXT SESSION</span>
            <h2>{t("landing.demoSplit")}</h2>
            <p>{t("landing.f.recordDesc")}</p>
            <Go href="/predict">
              {t("nav.predict")}
              <ArrowRight size={16} />
            </Go>
          </div>
          <div className="rx-demo-chart">
            {["4:16", "5:27", "6:24", "6:25", "6:34", "6:19", "6:26", "7:08"].map(
              (time, i) => (
                <div key={time + i}>
                  <span>{time}</span>
                  <i
                    style={{
                      height:
                        parseInt(time) * 20 + parseInt(time.slice(-2)) / 3 + "px",
                    }}
                  />
                  <small>R{i + 1}</small>
                </div>
              ),
            )}
          </div>
        </section>

        <section className="rx-landing-features">
          <h2>{t("landing.features")}</h2>
          <div>
            {features.map(([Icon, title, desc]) => (
              <article key={title}>
                <Icon size={28} />
                <h3>{t(title)}</h3>
                <p>{t(desc)}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="rx-public-footer">
        <b>ROXLOGY</b>
        <span>{t("landing.tagline")}</span>
        <span>
          <Link href="/predict">{t("nav.predict")}</Link>
          {" · "}
          <Link href="/events">{t("nav.events")}</Link>
          {" · "}
          <Link href="/crews">{t("nav.crews")}</Link>
        </span>
      </footer>
    </div>
  );
}
