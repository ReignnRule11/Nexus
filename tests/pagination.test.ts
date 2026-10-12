import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/http-error";
import {
  decodeCursor,
  encodeCursor,
  parsePageParams,
} from "@/lib/pagination";

describe("pagination", () => {
  it("bounds page size and parses cursors", () => {
    expect(parsePageParams(new URLSearchParams())).toEqual({
      limit: 20,
      cursor: null,
    });
    expect(parsePageParams(new URLSearchParams("limit=99")).limit).toBe(50);
    expect(() => parsePageParams(new URLSearchParams("limit=0"))).toThrow(
      HttpError,
    );
  });

  it("round-trips createdAt/id cursors", () => {
    const createdAt = new Date("2026-10-12T00:00:00.000Z");
    const encoded = encodeCursor(createdAt, "abc");
    expect(decodeCursor(encoded)).toEqual({ createdAt, id: "abc" });
    expect(() => decodeCursor("not-valid")).toThrow(HttpError);
  });
});
