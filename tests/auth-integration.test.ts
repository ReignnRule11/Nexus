import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as getCsrf } from "@/app/api/auth/csrf/route";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import {
  GET as getProfile,
  PATCH as patchProfile,
} from "@/app/api/profile/route";
import {
  getCurrentUser,
  requireActiveUser,
  requireUser,
  updateOwnProfile,
} from "@/lib/auth";
import { getPrismaClient } from "@/lib/db";
import { loadEnv } from "@/lib/env";
import { hashSessionToken } from "@/lib/session";
import { CSRF_STRATEGY } from "@/lib/csrf";
import {
  ensureTestAuthSecret,
  uniqueEmail,
  uniqueUsername,
} from "@/tests/user-fixtures";

const env = loadEnv(process.env);
const databaseUrl = env.databaseUrl;
const TEST_DATABASE_NAME = "nexus_test";
const ORIGIN = "http://localhost";
const PASSWORD = "correct-horse-battery";

function databaseNameFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\//, "");
    return name || undefined;
  } catch {
    return undefined;
  }
}

const connectedDatabaseName = databaseUrl
  ? databaseNameFromUrl(databaseUrl)
  : undefined;
const canRunIntegration =
  Boolean(databaseUrl) && connectedDatabaseName === TEST_DATABASE_NAME;

function cookiePairs(response: Response): string[] {
  const getter = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  if (typeof getter === "function") {
    return getter.call(response.headers);
  }
  const header = response.headers.get("set-cookie");
  return header ? [header] : [];
}

function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((entry) => entry.split(";")[0])
    .filter((part): part is string => Boolean(part))
    .join("; ");
}

function sessionCookieValue(setCookies: string[]): string | undefined {
  for (const entry of setCookies) {
    const pair = entry.split(";")[0];
    if (pair?.startsWith("nexus_session=")) {
      return pair.slice("nexus_session=".length);
    }
  }
  return undefined;
}

type JsonError = { error: { code: string; message: string; fields?: Record<string, string> } };
type JsonUser = {
  user: {
    id: string;
    email: string;
    status: string;
    profile: { username: string; displayName: string; bio: string | null };
  };
};
type JsonProfile = {
  profile: { username: string; displayName: string; bio: string | null; userId: string };
};

async function issueCsrf(existingCookies: string[] = []) {
  const response = await getCsrf(
    new Request(`${ORIGIN}/api/auth/csrf`, {
      headers: existingCookies.length
        ? { cookie: cookieHeader(existingCookies) }
        : undefined,
    }),
  );
  const body = (await response.json()) as { csrfToken: string };
  return {
    token: body.csrfToken,
    cookies: cookiePairs(response).length > 0 ? cookiePairs(response) : existingCookies,
  };
}

function jsonRequest(
  path: string,
  options: {
    method: string;
    cookies?: string[];
    csrf?: string;
    body?: unknown;
  },
): Request {
  const headers: Record<string, string> = {
    origin: ORIGIN,
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (options.csrf) {
    headers["x-csrf-token"] = options.csrf;
  }
  if (options.cookies && options.cookies.length > 0) {
    headers.cookie = cookieHeader(options.cookies);
  }
  return new Request(`${ORIGIN}${path}`, {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe.skipIf(canRunIntegration)(
  "authentication PostgreSQL integration (blocked by environment)",
  () => {
    it("does not mutate PostgreSQL unless DATABASE_URL points at nexus_test", () => {
      expect(connectedDatabaseName === TEST_DATABASE_NAME).toBe(false);
    });
  },
);

describe.skipIf(!canRunIntegration)("authentication PostgreSQL integration", () => {
  const createdUserIds: string[] = [];
  let prisma: ReturnType<typeof getPrismaClient>;

  beforeAll(() => {
    ensureTestAuthSecret();
    prisma = getPrismaClient();
  });

  afterEach(async () => {
    if (!prisma || createdUserIds.length === 0) {
      return;
    }
    const ids = [...createdUserIds];
    createdUserIds.length = 0;
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  async function registerAccount(
    overrides: Record<string, unknown> = {},
  ): Promise<{ response: Response; body: JsonUser; cookies: string[]; token: string }> {
    const csrf = await issueCsrf();
    const payload = {
      email: uniqueEmail("reg"),
      password: PASSWORD,
      username: uniqueUsername("reg"),
      displayName: "Ada Lovelace",
      ...overrides,
    };
    const response = await register(
      jsonRequest("/api/auth/register", {
        method: "POST",
        cookies: csrf.cookies,
        csrf: csrf.token,
        body: payload,
      }),
    );
    const body = (await response.json()) as JsonUser;
    const cookies = cookiePairs(response);
    if (body.user?.id) {
      createdUserIds.push(body.user.id);
    }
    return {
      response,
      body,
      cookies,
      token: sessionCookieValue(cookies) ?? "",
    };
  }

  it("registers a user, profile, hashed password, and hashed session", async () => {
    const email = uniqueEmail("ok");
    const username = uniqueUsername("ok");
    const result = await registerAccount({ email, username, displayName: "Ada Lovelace" });
    const serialized = JSON.stringify(result.body);

    expect(result.response.status).toBe(201);
    expect(result.body.user.email).toBe(email);
    expect(result.body.user.profile.username).toBe(username);
    expect(result.body.user.profile.displayName).toBe("Ada Lovelace");
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("password_hash");
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(result.token);

    const stored = await prisma.user.findUnique({
      where: { id: result.body.user.id },
      include: { profile: true, sessions: true },
    });
    expect(stored?.passwordHash).not.toBe(PASSWORD);
    expect(stored?.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(stored?.profile?.usernameNormalized).toBe(username.toLowerCase());
    expect(stored?.sessions).toHaveLength(1);
    expect(stored?.sessions[0]?.tokenHash).toBe(hashSessionToken(result.token));
    expect(stored?.sessions[0]?.tokenHash).not.toBe(result.token);
  });

  it("rejects duplicate email and username", async () => {
    const email = uniqueEmail("dup");
    const username = uniqueUsername("dup");
    await registerAccount({ email, username });

    const duplicateEmail = await registerAccount({
      email,
      username: uniqueUsername("dup2"),
    });
    expect(duplicateEmail.response.status).toBe(409);
    expect((duplicateEmail.body as unknown as JsonError).error.code).toBe("conflict");

    const duplicateUsername = await registerAccount({
      email: uniqueEmail("dup3"),
      username,
    });
    expect(duplicateUsername.response.status).toBe(409);
  });

  it("rejects invalid username, email, and weak passwords", async () => {
    const csrf = await issueCsrf();
    const invalidUsername = await register(
      jsonRequest("/api/auth/register", {
        method: "POST",
        cookies: csrf.cookies,
        csrf: csrf.token,
        body: {
          email: uniqueEmail("bad"),
          password: PASSWORD,
          username: "no spaces",
          displayName: "Ada",
        },
      }),
    );
    expect(invalidUsername.status).toBe(400);

    const invalidEmail = await register(
      jsonRequest("/api/auth/register", {
        method: "POST",
        cookies: csrf.cookies,
        csrf: csrf.token,
        body: {
          email: "not-an-email",
          password: PASSWORD,
          username: uniqueUsername("bad"),
          displayName: "Ada",
        },
      }),
    );
    expect(invalidEmail.status).toBe(400);

    const weakPassword = await register(
      jsonRequest("/api/auth/register", {
        method: "POST",
        cookies: csrf.cookies,
        csrf: csrf.token,
        body: {
          email: uniqueEmail("weak"),
          password: "short",
          username: uniqueUsername("weak"),
          displayName: "Ada",
        },
      }),
    );
    expect(weakPassword.status).toBe(400);
  });

  it("rejects registration without CSRF", async () => {
    const response = await register(
      jsonRequest("/api/auth/register", {
        method: "POST",
        body: {
          email: uniqueEmail("csrf"),
          password: PASSWORD,
          username: uniqueUsername("csrf"),
          displayName: "Ada",
        },
      }),
    );
    expect(response.status).toBe(403);
    expect(CSRF_STRATEGY).toMatch(/HMAC-signed CSRF cookie/);
  });

  it("authenticates valid credentials and rejects wrong or unknown accounts", async () => {
    const email = uniqueEmail("login");
    const created = await registerAccount({ email });
    await logout(
      jsonRequest("/api/auth/logout", {
        method: "POST",
        cookies: created.cookies,
        csrf: (await issueCsrf(created.cookies)).token,
      }),
    );

    const csrf = await issueCsrf();
    const success = await login(
      jsonRequest("/api/auth/login", {
        method: "POST",
        cookies: csrf.cookies,
        csrf: csrf.token,
        body: { email, password: PASSWORD },
      }),
    );
    const successBody = (await success.json()) as JsonUser;
    const successCookies = cookiePairs(success);
    const newToken = sessionCookieValue(successCookies) ?? "";
    if (successBody.user?.id) {
      createdUserIds.push(successBody.user.id);
    }

    expect(success.status).toBe(200);
    expect(successBody.user.email).toBe(email);
    expect(JSON.stringify(successBody)).not.toContain(PASSWORD);
    expect(JSON.stringify(successBody)).not.toContain(newToken);

    const wrong = await login(
      jsonRequest("/api/auth/login", {
        method: "POST",
        cookies: csrf.cookies,
        csrf: csrf.token,
        body: { email, password: "wrong-password-12" },
      }),
    );
    const unknown = await login(
      jsonRequest("/api/auth/login", {
        method: "POST",
        cookies: csrf.cookies,
        csrf: csrf.token,
        body: { email: uniqueEmail("missing"), password: PASSWORD },
      }),
    );
    const wrongBody = (await wrong.json()) as JsonError;
    const unknownBody = (await unknown.json()) as JsonError;
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongBody.error.message).toBe(unknownBody.error.message);
  });

  it("rejects suspended and deleted users on login and session resolve", async () => {
    const email = uniqueEmail("status");
    const created = await registerAccount({ email });
    await prisma.user.update({
      where: { id: created.body.user.id },
      data: { status: "SUSPENDED" },
    });

    expect(await getCurrentUser(created.token)).toBeNull();
    await expect(requireActiveUser(created.token)).rejects.toMatchObject({
      code: "account_inactive",
    });

    const csrf = await issueCsrf();
    const suspendedLogin = await login(
      jsonRequest("/api/auth/login", {
        method: "POST",
        cookies: csrf.cookies,
        csrf: csrf.token,
        body: { email, password: PASSWORD },
      }),
    );
    expect(suspendedLogin.status).toBe(403);

    await prisma.user.update({
      where: { id: created.body.user.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
    const deletedLogin = await login(
      jsonRequest("/api/auth/login", {
        method: "POST",
        cookies: csrf.cookies,
        csrf: csrf.token,
        body: { email, password: PASSWORD },
      }),
    );
    expect(deletedLogin.status).toBe(403);
    expect(await getCurrentUser(created.token)).toBeNull();
  });

  it("resolves valid sessions and rejects invalid or expired tokens", async () => {
    const created = await registerAccount();
    const current = await me(jsonRequest("/api/auth/me", { method: "GET", cookies: created.cookies }));
    const currentBody = (await current.json()) as JsonUser;
    expect(current.status).toBe(200);
    expect(currentBody.user.id).toBe(created.body.user.id);
    expect(JSON.stringify(currentBody)).not.toContain("passwordHash");
    expect(JSON.stringify(currentBody)).not.toContain(created.token);

    const invalid = await me(
      jsonRequest("/api/auth/me", {
        method: "GET",
        cookies: ["nexus_session=not-a-real-session-token"],
      }),
    );
    expect(invalid.status).toBe(401);

    await prisma.session.updateMany({
      where: { tokenHash: hashSessionToken(created.token) },
      data: { expiresAt: new Date("2000-01-01T00:00:00.000Z") },
    });
    expect(await getCurrentUser(created.token)).toBeNull();
    await expect(requireUser(created.token)).rejects.toMatchObject({
      code: "unauthenticated",
    });
  });

  it("rotates the session on login and invalidates the previous cookie", async () => {
    const created = await registerAccount();
    const csrf = await issueCsrf(created.cookies);
    const relogin = await login(
      jsonRequest("/api/auth/login", {
        method: "POST",
        cookies: created.cookies,
        csrf: csrf.token,
        body: { email: created.body.user.email, password: PASSWORD },
      }),
    );
    const reloginCookies = cookiePairs(relogin);
    const rotated = sessionCookieValue(reloginCookies) ?? "";
    expect(relogin.status).toBe(200);
    expect(rotated).not.toBe(created.token);
    expect(await getCurrentUser(created.token)).toBeNull();
    expect((await getCurrentUser(rotated))?.id).toBe(created.body.user.id);
  });

  it("logs out by deleting the session and clearing cookies, including repeats", async () => {
    const created = await registerAccount();
    const csrf = await issueCsrf(created.cookies);
    const first = await logout(
      jsonRequest("/api/auth/logout", {
        method: "POST",
        cookies: created.cookies,
        csrf: csrf.token,
      }),
    );
    const firstCookies = cookiePairs(first);
    expect(first.status).toBe(200);
    expect(firstCookies.join("\n")).toMatch(/nexus_session=;/);
    expect(firstCookies.join("\n")).toMatch(/Max-Age=0/);
    expect(
      await prisma.session.findUnique({
        where: { tokenHash: hashSessionToken(created.token) },
      }),
    ).toBeNull();

    const second = await logout(
      jsonRequest("/api/auth/logout", { method: "POST" }),
    );
    expect(second.status).toBe(200);
  });

  it("lets an authenticated user read and update their profile", async () => {
    const created = await registerAccount({ displayName: "Ada Lovelace" });
    const read = await getProfile(
      jsonRequest("/api/profile", { method: "GET", cookies: created.cookies }),
    );
    const readBody = (await read.json()) as JsonProfile;
    expect(read.status).toBe(200);
    expect(readBody.profile.username).toBe(created.body.user.profile.username);

    const csrf = await issueCsrf(created.cookies);
    const nextUsername = uniqueUsername("upd");
    const updated = await patchProfile(
      jsonRequest("/api/profile", {
        method: "PATCH",
        cookies: created.cookies,
        csrf: csrf.token,
        body: {
          username: nextUsername,
          displayName: "Ada Byron",
          bio: "Builder",
        },
      }),
    );
    const updatedBody = (await updated.json()) as JsonProfile;
    expect(updated.status).toBe(200);
    expect(updatedBody.profile.username).toBe(nextUsername);
    expect(updatedBody.profile.displayName).toBe("Ada Byron");
    expect(updatedBody.profile.bio).toBe("Builder");
  });

  it("enforces username uniqueness and rejects unauthorized or invalid profile updates", async () => {
    const first = await registerAccount();
    const second = await registerAccount();
    const csrf = await issueCsrf(second.cookies);
    const conflict = await patchProfile(
      jsonRequest("/api/profile", {
        method: "PATCH",
        cookies: second.cookies,
        csrf: csrf.token,
        body: { username: first.body.user.profile.username },
      }),
    );
    expect(conflict.status).toBe(409);

    const invalid = await patchProfile(
      jsonRequest("/api/profile", {
        method: "PATCH",
        cookies: second.cookies,
        csrf: csrf.token,
        body: { username: "no spaces" },
      }),
    );
    expect(invalid.status).toBe(400);

    await expect(
      updateOwnProfile(second.body.user.id, first.body.user.id, {
        displayName: "Nope",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("does not expose database internals on constraint conflicts", async () => {
    const email = uniqueEmail("safe");
    await registerAccount({ email });
    const conflict = await registerAccount({ email });
    const payload = JSON.stringify(conflict.body);
    expect(payload).not.toContain("P2002");
    expect(payload).not.toContain("Prisma");
    expect(payload).not.toContain("password_hash");
  });
});
