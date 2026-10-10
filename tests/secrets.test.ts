import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "coverage",
  "e2e",
  "generated",
  "node_modules",
  "playwright-report",
  "test-results",
  "tests",
]);

const CLIENT_SECRET_PATTERNS = [
  /NEXT_PUBLIC_DATABASE_URL/,
  /NEXT_PUBLIC_AUTH_SECRET/,
  /NEXT_PUBLIC_USER_LLM_API_KEY/,
  /process\.env\.DATABASE_URL/,
  /process\.env\.AUTH_SECRET/,
  /process\.env\.USER_LLM_API_KEY/,
];

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }

    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry))) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("secret exposure", () => {
  it("does not expose privileged credentials to client-side code", () => {
    const files = walk(ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const isClient =
        source.includes("'use client'") || source.includes('"use client"');
      const relative = path.relative(ROOT, file);

      if (isClient) {
        for (const pattern of CLIENT_SECRET_PATTERNS) {
          if (pattern.test(source)) {
            violations.push(`${relative} matches ${pattern}`);
          }
        }
      }

      if (
        /NEXT_PUBLIC_(DATABASE_URL|AUTH_SECRET|USER_LLM_API_KEY)/.test(source)
      ) {
        violations.push(`${relative} prefixes a secret with NEXT_PUBLIC_`);
      }
    }

    expect(violations).toEqual([]);
  });
});
