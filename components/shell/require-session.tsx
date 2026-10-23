"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useSession } from "@/lib/client/session";
import { LoadingState } from "@/components/ui/status";

export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useSession();

  if (status === "loading") {
    return <LoadingState label="Checking session" />;
  }

  if (status === "inactive") {
    return (
      <main className="page-narrow">
        <h1>Account unavailable</h1>
        <p>This account cannot use Project Nexus right now.</p>
        <Link href="/login">Return to sign in</Link>
      </main>
    );
  }

  if (status !== "authenticated") {
    return (
      <main className="page-narrow">
        <h1>Sign in required</h1>
        <p>This area is for signed-in accounts.</p>
        <p>
          <Link href="/login">Sign in</Link> or <Link href="/register">create an account</Link>.
        </p>
      </main>
    );
  }

  return <>{children}</>;
}
