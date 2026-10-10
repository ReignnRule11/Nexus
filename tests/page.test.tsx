/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "@/app/page";

describe("root page", () => {
  it("renders the Project Nexus landing copy", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: "Project Nexus" }),
    ).toBeTruthy();
    expect(screen.getByText("Connect with purpose.")).toBeTruthy();
    expect(
      screen.getByText(/The platform is under development/),
    ).toBeTruthy();
  });
});
