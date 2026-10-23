"use client";

import { Button } from "@/components/ui/button";

export default function Error({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main id="main-content" className="page-narrow">
      <h1>Something went wrong</h1>
      <p>The page could not be loaded. Try again.</p>
      <Button onClick={() => retry()}>Try again</Button>
    </main>
  );
}
