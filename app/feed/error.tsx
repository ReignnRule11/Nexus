"use client";

import { Button } from "@/components/ui/button";

export default function Error({ retry }: { error: Error; retry: () => void }) {
  return (
    <main id="main-content" className="page-content">
      <h1>Feed unavailable</h1>
      <p>The feed could not be loaded.</p>
      <Button onClick={() => retry()}>Try again</Button>
    </main>
  );
}
