import { PageSkeleton } from "@/components/skeleton";

export default function Loading() {
  return <PageSkeleton shape="board" cards={3} head={false} />;
}
