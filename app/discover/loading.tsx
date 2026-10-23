import { Skeleton } from "@/components/ui/status";

export default function Loading() {
  return (
    <main id="main-content" className="page-content">
      <Skeleton label="Loading discovery" />
    </main>
  );
}
