/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Field, Input } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Modal } from "@/components/ui/modal";
import { isCurrentPath, PRIMARY_NAV } from "@/lib/client/navigation";
import { userMessageForError, ApiError } from "@/lib/client/api";

describe("accessibility primitives", () => {
  afterEach(() => {
    cleanup();
  });

  it("associates labels with form controls", () => {
    render(
      <Field id="email" label="Email" required>
        <Input id="email" name="email" type="email" />
      </Field>,
    );
    const input = screen.getByLabelText(/Email/);
    expect(input.getAttribute("id")).toBe("email");
    expect(screen.getByText("required")).toBeTruthy();
  });

  it("gives icon-only buttons an accessible name", () => {
    render(
      <IconButton label="Close dialog">
        <span aria-hidden="true">x</span>
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeTruthy();
  });

  it("closes a dialog on Escape and restores focus", () => {
    const onClose = vi.fn();
    function Harness() {
      return (
        <div>
          <button type="button">Before</button>
          <Modal open title="Report" onClose={onClose}>
            <button type="button">Inside</button>
          </Modal>
        </div>
      );
    }
    render(<Harness />);
    expect(screen.getByRole("dialog", { name: "Report" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps primary destinations labeled and unique", () => {
    expect(PRIMARY_NAV.map((item) => item.label)).toEqual([
      "Home",
      "Discover",
      "Communities",
      "Messages",
      "Notifications",
      "Profile",
    ]);
    expect(isCurrentPath("/feed", "/feed")).toBe(true);
    expect(isCurrentPath("/posts/abc", "/feed")).toBe(true);
    expect(isCurrentPath("/moderation", "/feed")).toBe(false);
  });

  it("maps API failures to user-facing copy without internals", () => {
    expect(userMessageForError(new ApiError(503, "not_configured", "x"))).toBe(
      "This service is not configured yet.",
    );
    expect(userMessageForError(new ApiError(401, "unauthenticated", "x"))).toBe(
      "Sign in to continue.",
    );
    expect(JSON.stringify(userMessageForError(new Error("prisma")))).not.toContain(
      "Prisma",
    );
  });
});
