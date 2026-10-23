import type { Metadata } from "next";
import { Suspense } from "react";
import { SessionProvider } from "@/lib/client/session";
import { AppShell } from "@/components/shell/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project Nexus",
  description: "Connect with purpose.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <SessionProvider>
          <Suspense fallback={null}>
            <AppShell>{children}</AppShell>
          </Suspense>
        </SessionProvider>
      </body>
    </html>
  );
}
