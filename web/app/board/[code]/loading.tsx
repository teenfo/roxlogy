import { PageSkeleton } from "@/components/skeleton";

export default function Loading() {
  return <div data-theme="dark" className="rx-live-board p-6"><PageSkeleton variant="board" /></div>;
}
