// Run from web/: npm run og:generate [-- /tmp/roxlogy-og-samples]
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadTypeScript } from "./load-typescript.mjs";
const { renderCard, eventDate } = loadTypeScript("lib/og/card.tsx");

async function save(path, content) {
  const response = await renderCard(content);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  console.log(path);
}

async function main() {
  await save("app/opengraph-image.png", null);
  const destination = process.argv[2];
  if (!destination) return;
  await mkdir(destination, { recursive: true });
  await save(join(destination, "crew.png"), {
    kind: "crew", title: "함께 달리는 크루 LOOP8", subtitle: "Train together. Go further.",
    details: "서울 · 하이브리드 트레이닝", count: "23", countLabel: "MEMBERS",
  });
  await save(join(destination, "event.png"), {
    kind: "event", title: "일요일, 함께 만드는 새로운 기록", subtitle: "LOOP8",
    details: eventDate("2026-09-27T00:00:00Z"), count: "21 / 30", countLabel: "GOING",
  });
  await save(join(destination, "long-title.png"), {
    kind: "event", title: "아주 긴 모임 이름과 함께 훈련하는 모든 멤버를 위한 주말 프로그램 미리보기",
    subtitle: "Comunidad de entrenamiento híbrido · España",
    details: eventDate("2026-09-27T15:30:00Z"), count: "120 / 200", countLabel: "GOING",
  });
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
