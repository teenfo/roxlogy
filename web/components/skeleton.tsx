/**
 * 로딩 스켈레톤 (디자인 스펙 1.3 §20).
 *
 * 실제 레이아웃 모양으로 자리를 잡아 데이터가 늦어도 화면이 비어 보이지 않게
 * 한다. 모양이 실제와 다르면 오히려 화면이 한 번 튀므로, 라우트마다 그 화면의
 * 뼈대를 고른다.
 *
 * 스펙은 22개 화면을 나열하지만 실제로 다른 뼈대는 일곱 가지다 —
 * 목록·상세·폼·대시보드·달력·회계·보드. 22개를 따로 만들면 화면이 바뀔 때마다
 * 두 곳을 고쳐야 해서 금방 어긋난다.
 *
 * 접근성: 바깥에 role="status" + aria-busy, 안쪽 장식 블록은 전부 aria-hidden,
 * 실제 읽히는 건 sr-only 라벨 하나. 깜빡임은 motion-safe 에서만 돈다.
 */
export type SkeletonShape =
  | "list"
  | "detail"
  | "form"
  | "dashboard"
  | "calendar"
  | "finance"
  | "board";

const bar = "rounded bg-line-soft motion-safe:animate-pulse";
const block = "rounded-[14px] border border-line bg-card motion-safe:animate-pulse";

function Head() {
  return (
    <div className="mb-[27px] flex flex-col gap-2" aria-hidden>
      <div className={`h-8 w-56 max-w-full ${bar} bg-line`} />
      <div className={`h-4 w-80 max-w-full ${bar}`} />
    </div>
  );
}

function Rows({ n }: { n: number }) {
  return (
    <div className={`${block} divide-y divide-line-soft`} aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className={`h-4 w-1/3 ${bar} bg-line`} />
          <div className={`ml-auto h-3 w-16 ${bar}`} />
        </div>
      ))}
    </div>
  );
}

function Kpis({ n = 4 }: { n?: number }) {
  return (
    <div
      className="mb-[25px] grid grid-cols-4 gap-4 max-[1000px]:grid-cols-2 max-[600px]:gap-3"
      aria-hidden
    >
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className={`${block} flex flex-col gap-2 px-5 py-[18px]`}>
          <div className={`h-3 w-20 ${bar}`} />
          <div className={`h-6 w-24 ${bar} bg-line`} />
        </div>
      ))}
    </div>
  );
}

function Body({ shape, cards }: { shape: SkeletonShape; cards: number }) {
  switch (shape) {
    case "dashboard":
      return (
        <>
          <Kpis />
          <div className="flex flex-col gap-4">
            <Rows n={4} />
            <div className={`${block} h-56`} aria-hidden />
          </div>
        </>
      );

    case "finance":
      return (
        <>
          <Kpis />
          <div
            className="grid gap-6 min-[900px]:grid-cols-[minmax(0,1fr)_320px]"
            aria-hidden
          >
            <Rows n={6} />
            <div className="flex flex-col gap-4">
              <div className={`${block} h-40`} />
              <div className={`${block} h-56`} />
            </div>
          </div>
        </>
      );

    case "detail":
      return (
        <div className="flex flex-col gap-4" aria-hidden>
          <div className={`${block} h-32`} />
          <div className={`${block} h-64`} />
          <Rows n={4} />
        </div>
      );

    case "form":
      return (
        <div className={`${block} flex flex-col gap-5 p-6`} aria-hidden>
          {Array.from({ length: cards + 2 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className={`h-3 w-24 ${bar}`} />
              <div className={`h-[42px] w-full ${bar} bg-line`} />
            </div>
          ))}
          <div className={`h-[42px] w-32 ${bar} bg-line`} />
        </div>
      );

    case "calendar":
      return (
        <div className="flex flex-col gap-4" aria-hidden>
          <div className={`h-10 w-48 ${bar} bg-line`} />
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className={`h-16 ${block}`} />
            ))}
          </div>
        </div>
      );

    case "board":
      // 라이브보드는 다크로 남는 화면이다 — 스켈레톤도 같은 면 위에 있어야 한다
      return (
        <div className="theme-dark grid gap-4 p-4 lg:grid-cols-3" aria-hidden>
          <div className={`${block} h-80`} />
          <div className={`${block} h-80`} />
          <div className={`${block} h-80`} />
        </div>
      );

    case "list":
    default:
      return (
        <div className="flex flex-col gap-4" aria-hidden>
          <div className="flex gap-2">
            <div className={`h-10 w-full max-w-[450px] ${bar} bg-line`} />
            <div className={`h-10 w-28 ${bar}`} />
          </div>
          <Rows n={Math.max(cards, 5)} />
        </div>
      );
  }
}

export function PageSkeleton({
  shape = "list",
  cards = 3,
  label = "Loading",
  head = true,
}: {
  shape?: SkeletonShape;
  /** 목록/폼의 줄 수 — 실제 화면과 비슷하게 */
  cards?: number;
  label?: string;
  /** 제목 자리를 그릴지. 보드처럼 제목이 없는 화면은 끈다 */
  head?: boolean;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      {head && <Head />}
      <Body shape={shape} cards={cards} />
      <span className="sr-only">{label}</span>
    </div>
  );
}
