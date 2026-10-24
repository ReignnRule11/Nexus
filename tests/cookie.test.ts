import { describe, expect, it } from "vitest";
import { getCookie, serializeCookie } from "@/lib/cookie";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session";

describe("cookie parsing", () => {
  it("round-trips encoded cookie values", () => {
    const cookie = serializeCookie(
      SESSION_COOKIE_NAME,
      "token+with/special=",
      sessionCookieOptions(false),
    );

    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=token%2Bwith%2Fspecial%3D`);
    expect(getCookie(cookie, SESSION_COOKIE_NAME)).toBe("token+with/special=");
  });

  it("ignores malformed percent-encoded cookie values", () => {
    expect(getCookie(`${SESSION_COOKIE_NAME}=%E0%A4%A`, SESSION_COOKIE_NAME)).toBeUndefined();
  });
});
