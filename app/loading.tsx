import { LoadingState } from "@/components/ui/status";

export default function Loading() {
  return (
    <main id="main-content" className="page-narrow">
      <LoadingState label="Loading" />
    </main>
  );
}
