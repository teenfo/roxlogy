import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const OG_SIZE = { width: 1200, height: 630 };
export type CardContent = {
  kind: "crew" | "event";
  title: string;
  subtitle: string;
  details: string;
  count: string;
  countLabel: string;
};

// Files are immutable; one read per warm server instance, not a CDN fetch per card.
const assets = Promise.all([
  readFile(join(process.cwd(), "assets/og/IBMPlexSansKR-Bold.ttf")),
  readFile(join(process.cwd(), "assets/og/ArchivoBlack-Regular.ttf")),
  readFile(join(process.cwd(), "public/roxlogy-mark.svg")),
]);

/** Bound text to the card's available space; normalize decomposed Korean names. */
export function cardText(value: string, max: number): string {
  const text = value.normalize("NFC").replace(/[\r\n\t]+/g, " ").trim();
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : text;
}

/** Share cards have one stable time zone, independent of the visitor's cookies. */
export function eventDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul",
  }).format(new Date(value)) + " KST";
}

export async function renderCard(content: CardContent | null) {
  const [korean, archivo, mark] = await assets;
  const markSrc = `data:image/svg+xml;base64,${mark.toString("base64")}`;
  return new ImageResponse(
    <div style={{
      width: "100%", height: "100%", display: "flex", flexDirection: "column",
      padding: "52px 64px", background: "#222930", color: "#F4F4F2",
      fontFamily: "Plex", fontWeight: 700,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {/* Satori consumes an embedded source asset; next/image is not used here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={markSrc} width={72} height={72} alt="" />
        <div style={{ fontFamily: "Archivo", fontSize: 32, letterSpacing: -1 }}>ROXLOGY</div>
        <div style={{ display: "flex", marginLeft: "auto", color: "#FFD500", fontSize: 18, letterSpacing: 3 }}>
          {content ? (content.kind === "crew" ? "CREW" : "CREW MEETUP") : "HYBRID RACING"}
        </div>
      </div>
      {content ? (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, marginTop: 35 }}>
          <div style={{ color: "#ACB8C1", fontSize: 23 }}>{cardText(content.subtitle, 46)}</div>
          <div style={{ display: "flex", alignItems: "center", height: 172, fontSize: 55, lineHeight: 1.2, letterSpacing: -1.5, overflow: "hidden" }}>
            {cardText(content.title, 36)}
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: "auto", paddingTop: 25, borderTop: "1px solid #46515B" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
              <div style={{ fontSize: 26 }}>{cardText(content.details, 40)}</div>
              <div style={{ color: "#ACB8C1", fontSize: 19 }}>
                {content.kind === "crew" ? "Train together. Go further." : "View the meetup. Join your crew."}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginLeft: 28 }}>
              <div style={{ fontSize: 48, color: "#FFD500", lineHeight: 1.1 }}>{content.count}</div>
              <div style={{ fontSize: 17, color: "#ACB8C1", marginTop: 6 }}>{content.countLabel}</div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1 }}>
          <div style={{ fontFamily: "Archivo", fontSize: 110, letterSpacing: -4 }}>ROXLOGY</div>
          <div style={{ fontSize: 35, color: "#ACB8C1", marginTop: 14 }}>The science of hybrid racing</div>
          <div style={{ display: "flex", height: 7, width: 96, background: "#FFD500", marginTop: 34 }} />
        </div>
      )}
      <div style={{ display: "flex", color: "#ACB8C1", fontSize: 18, marginTop: 30 }}>roxlogy.com</div>
    </div>,
    {
      ...OG_SIZE,
      fonts: [
        { name: "Plex", data: korean, weight: 700, style: "normal" },
        { name: "Archivo", data: archivo, weight: 400, style: "normal" },
      ],
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function brandFallback() {
  const bytes = await readFile(join(process.cwd(), "app/opengraph-image.png"));
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
