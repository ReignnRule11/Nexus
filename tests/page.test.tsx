/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Home from "@/app/page";

describe("root page", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the Project Nexus landing copy and auth entry points", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: "Project Nexus" }),
    ).toBeTruthy();
    expect(screen.getByText("Connect with purpose.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create account" })).toBeTruthy();
  });
});
