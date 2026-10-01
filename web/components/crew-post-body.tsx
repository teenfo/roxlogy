import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { postImageUrls } from "@/lib/crew-media";

/**
 * 크루 게시물 본문 — 마크다운으로 그린다(크루 운영 제안서 C, 2026-10-01).
 *
 * 보안 — 게시판은 활동 크루원 누구나 쓰는 칸이다.
 *   - **rehype-raw 금지.** react-markdown 은 raw HTML 을 실행하지 않고, skipHtml 로 글자로도 남기지 않는다. rehype-raw 를
 *     넣는 순간 `<img onerror>` 같은 저장형 XSS 가 열리고, 그 글을 연 사람의 Supabase 세션으로
 *     RLS 가 그 사람 권한을 내준다(운영진이면 회계·가입 승인까지). dangerouslySetInnerHTML 도 금지.
 *   - 링크 주소의 `javascript:` 등은 react-markdown 기본 urlTransform 이 지운다.
 *   - 이미지는 https 외부 링크만(lib/crew-media.ts) + no-referrer·lazy. 업로드 기능은 두지 않는다.
 *
 * 기존 글 호환 — 지금까지의 글은 평문이고 줄바꿈을 손으로 넣었다. remark-breaks 가 홑줄바꿈을
 * 그대로 살린다(빼면 모든 옛 글의 줄이 뭉개진다).
 *
 * typography 플러그인이 없어 요소별 스타일을 여기서 준다(다크 토큰).
 */
const components: Components = {
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h2 className="mb-2 mt-6 text-lg font-bold text-foreground first:mt-0">{children}</h2>,
  h2: ({ children }) => <h3 className="mb-2 mt-6 text-base font-bold text-foreground first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-5 text-sm font-bold text-foreground first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mb-1.5 mt-5 text-sm font-bold text-foreground first:mt-0">{children}</h4>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-line-strong pl-3 text-muted">{children}</blockquote>
  ),
  hr: () => <hr className="my-6 border-line" />,
  code: ({ children }) => (
    <code className="rounded bg-inset px-1 py-0.5 font-mono text-[13px] [overflow-wrap:anywhere]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-md bg-inset p-3 text-[13px] [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-line px-2 py-1 text-left font-bold">{children}</th>,
  td: ({ children }) => <td className="border border-line px-2 py-1 align-top">{children}</td>,
  a: ({ href, children }) => {
    // 위험한 주소(javascript: 등)는 urlTransform 이 비워 둔다 — 링크 없이 글자만 남긴다
    if (!href) return <span>{children}</span>;
    // 같은 사이트(/crews/…)는 같은 탭, 바깥 주소는 새 탭 + 리퍼러·검색 순위 넘기지 않기
    const external = !!href && /^https?:\/\//i.test(href);
    return (
      <a
        href={href}
        className="text-accent underline underline-offset-2 [overflow-wrap:anywhere]"
        {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const safe = typeof src === "string" ? postImageUrls([src])[0] : undefined;
    if (!safe) return null;
    return (
      // GIF 애니메이션을 살리려고 next/image 대신 <img>
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={safe}
        alt={alt ?? ""}
        loading="lazy"
        decoding="async"
                referrerPolicy="no-referrer"
        className="my-3 block h-auto w-full rounded-md border border-surface bg-card"
      />
    );
  },
};

export function CrewPostBody({ body }: { body: string }) {
  return (
    <div className="text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
      {/* rehype-raw 금지 — 위 주석 참고 */}
      {/* skipHtml: 본문 속 HTML 태그는 실행도 표시도 하지 않는다(글자로도 남기지 않음) */}
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components} skipHtml>
        {body}
      </ReactMarkdown>
    </div>
  );
}

/** 본문에 마크다운 이미지로 이미 넣은 주소 — 글 끝 이미지 모음에서 빼서 두 번 보이지 않게 한다 */
export function imagesInBody(body: string | null): Set<string> {
  const out = new Set<string>();
  if (!body) return out;
  const raw = [...body.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?/g)].map((m) => m[1]);
  // 글 끝 모음과 같은 기준(정규화한 https 주소)으로 비교한다
  for (const u of postImageUrls(raw)) out.add(u);
  return out;
}
