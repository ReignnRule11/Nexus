"use client";

import { Suspense, type ReactNode } from "react";
import { useSession } from "@/lib/client/session";
import { AppNav } from "@/components/shell/app-nav";

export function AppShell({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const authenticated = status === "authenticated";

  return (
    <div className={authenticated ? "app-shell authenticated" : "app-shell public"}>
      <Suspense fallback={null}>
        <AppNav />
      </Suspense>
      <div className="app-main">{children}</div>
    </div>
  );
}
