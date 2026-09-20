import { PageSkeleton } from "@/components/skeleton";

export default function Loading() {
  return <PageSkeleton shape="list" cards={5} />;
}
