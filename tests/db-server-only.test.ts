import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "coverage",
  "e2e",
  "generated",
  "node_modules",
  "playwright-report",
  "prisma",
  "test-results",
  "tests",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP_DIRS.has(entry)) {
      return [];
    }

    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      return walk(fullPath);
    }

    if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) {
      return [fullPath];
    }

    return [];
  });
}

describe("server-only database module", () => {
  it("marks the Prisma client as server-only", () => {
    const dbSource = readFileSync(path.join(ROOT, "lib", "db.ts"), "utf8");

    expect(dbSource).toContain('import "server-only"');
    expect(dbSource).toContain("requireDatabaseUrl");
    expect(dbSource).toContain("PrismaClient");
  });

  it("marks environment loading as server-only", () => {
    const envSource = readFileSync(path.join(ROOT, "lib", "env.ts"), "utf8");

    expect(envSource).toContain('import "server-only"');
    expect(envSource).toContain("DATABASE_URL");
  });

  it("marks authentication modules as server-only", () => {
    const files = [
      "auth.ts",
      "auth-http.ts",
      "cookie.ts",
      "password.ts",
      "session.ts",
      "csrf.ts",
      "authorization.ts",
    ];

    for (const file of files) {
      const source = readFileSync(path.join(ROOT, "lib", file), "utf8");
      expect(source, file).toContain('import "server-only"');
    }
  });

  it("is not imported by client components or public pages", () => {
    const files = walk(ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const relative = path.relative(ROOT, file);
      const isClient =
        source.includes("'use client'") || source.includes('"use client"');
      const importsDbModule =
        source.includes('from "@/lib/db"') ||
        source.includes("from '@/lib/db'");

      if (
        importsDbModule &&
        (isClient ||
          (relative.startsWith("app/") && relative.endsWith("page.tsx")))
      ) {
        violations.push(relative);
      }
    }

    expect(violations).toEqual([]);
  });
});
