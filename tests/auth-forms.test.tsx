/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm, RegisterForm } from "@/components/auth/auth-forms";
import { SessionProvider } from "@/lib/client/session";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

describe("authentication forms", () => {
  afterEach(() => {
    cleanup();
  });

  it("labels login controls and uses password semantics", () => {
    render(
      <SessionProvider>
        <LoginForm />
      </SessionProvider>,
    );
    expect(screen.getByLabelText(/Email/)).toHaveProperty("type", "email");
    expect(screen.getByLabelText(/Password/)).toHaveProperty("type", "password");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("labels registration controls without placeholder-only labeling", () => {
    render(
      <SessionProvider>
        <RegisterForm />
      </SessionProvider>,
    );
    expect(screen.getByLabelText(/Email/)).toBeTruthy();
    expect(screen.getByLabelText(/^Password/)).toBeTruthy();
    expect(screen.getByLabelText(/Username/)).toBeTruthy();
    expect(screen.getByLabelText(/Display name/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
  });
});
