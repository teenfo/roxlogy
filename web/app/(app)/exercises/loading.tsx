import { PageSkeleton } from "@/components/skeleton";

export default function Loading() {
  return <PageSkeleton shape="cards" cards={8} />;
}
