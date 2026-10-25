import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import type { UserStatus } from "@/lib/generated/prisma/client";
import { assertAuthAbuseLimit } from "@/lib/auth-abuse";
import type { ClientIdentity } from "@/lib/client-identity";
import { assertAccountOwner } from "@/lib/authorization";
import { getPrismaClient } from "@/lib/db";
import { loadEnv, requireAuthSecret } from "@/lib/env";
import { HttpError } from "@/lib/http-error";
import {
  identityLimits,
  isValidBio,
  isValidDisplayName,
  isValidEmail,
  isValidPassword,
  isValidUsername,
  normalizeBio,
  normalizeDisplayName,
  normalizeEmail,
  normalizeUsername,
} from "@/lib/identity";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createCsrfToken } from "@/lib/csrf";
import {
  generateSessionToken,
  hashSessionToken,
  sessionExpiryDate,
} from "@/lib/session";

export type PublicProfile = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  bio: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicUser = {
  id: string;
  email: string;
  status: UserStatus;
  isModerator: boolean;
  createdAt: Date;
  updatedAt: Date;
  profile: PublicProfile;
};

export type IssuedSession = {
  token: string;
  expiresAt: Date;
  csrfToken: string;
};

export type AuthResult = {
  user: PublicUser;
  session: IssuedSession;
};

export type RegisterInput = {
  email: unknown;
  password: unknown;
  username: unknown;
  displayName: unknown;
};

export type LoginInput = {
  email: unknown;
  password: unknown;
};

export type ProfileUpdateInput = {
  username?: unknown;
  displayName?: unknown;
  bio?: unknown;
};

type UserWithProfile = {
  id: string;
  email: string;
  status: UserStatus;
  isModerator: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  profile: {
    id: string;
    userId: string;
    username: string;
    displayName: string;
    bio: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

export function toPublicProfile(
  profile: NonNullable<UserWithProfile["profile"]>,
): PublicProfile {
  return {
    id: profile.id,
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    bio: profile.bio,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function toPublicUser(user: UserWithProfile): PublicUser {
  if (!user.profile) {
    throw new HttpError(500, "internal", "Something went wrong.");
  }

  return {
    id: user.id,
    email: user.email,
    status: user.status,
    isModerator: user.isModerator === true,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    profile: toPublicProfile(user.profile),
  };
}

export async function registerUser(
  input: RegisterInput,
  previousSessionToken?: string,
  client?: ClientIdentity,
): Promise<AuthResult> {
  requireAuthSecret();
  if (!client) {
    throw new HttpError(503, "not_configured", "Client identity is unavailable.");
  }
  await assertAuthAbuseLimit("register", client);
  requireDatabaseConfigured();

  const email = readRequiredString(input.email, "email");
  const password = readRequiredString(input.password, "password");
  const username = readRequiredString(input.username, "username");
  const displayName = readRequiredString(input.displayName, "displayName");

  const fields: Record<string, string> = {};
  if (!isValidEmail(email)) {
    fields.email = "Enter a valid email address.";
  }
  if (!isValidPassword(password)) {
    fields.password = `Password must be ${identityLimits.passwordMinLength}-${identityLimits.passwordMaxLength} characters.`;
  }
  if (!isValidUsername(username)) {
    fields.username =
      "Username must be 3-32 characters and contain only letters, numbers, or underscores.";
  }
  if (!isValidDisplayName(displayName)) {
    fields.displayName = `Display name must be ${identityLimits.displayNameMinLength}-${identityLimits.displayNameMaxLength} characters.`;
  }
  throwIfFields(fields);

  const normalizedEmail = normalizeEmail(email);
  const normalizedUsername = normalizeUsername(username);
  const normalizedDisplayName = normalizeDisplayName(displayName);
  const passwordHash = await hashPassword(password);
  const prisma = getPrismaClient();

  let created: UserWithProfile;
  try {
    created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          emailNormalized: normalizedEmail,
          passwordHash,
          status: "ACTIVE",
          profile: {
            create: {
              username: username.trim(),
              usernameNormalized: normalizedUsername,
              displayName: normalizedDisplayName,
            },
          },
        },
        include: { profile: true },
      });
      return user;
    });
  } catch (error) {
    throw mapConstraintError(error);
  }

  await invalidateSessionToken(previousSessionToken);

  return {
    user: toPublicUser(created),
    session: await createSessionForUser(created.id),
  };
}

export async function loginUser(
  input: LoginInput,
  previousSessionToken?: string,
  client?: ClientIdentity,
): Promise<AuthResult> {
  requireAuthSecret();
  if (!client) {
    throw new HttpError(503, "not_configured", "Client identity is unavailable.");
  }
  await assertAuthAbuseLimit("login", client);
  requireDatabaseConfigured();

  const email = readRequiredString(input.email, "email");
  const password = readRequiredString(input.password, "password");

  const fields: Record<string, string> = {};
  if (!isValidEmail(email)) {
    fields.email = "Enter a valid email address.";
  }
  if (typeof input.password !== "string" || input.password.length === 0) {
    fields.password = "Password is required.";
  }
  throwIfFields(fields);

  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({
    where: { emailNormalized: normalizeEmail(email) },
    include: { profile: true },
  });

  const passwordHash = user?.passwordHash ?? (await dummyPasswordHash());
  const passwordMatches = await verifyPassword(passwordHash, password);

  if (!user || !passwordMatches) {
    throw new HttpError(
      401,
      "invalid_credentials",
      "Invalid email or password.",
    );
  }

  if (user.status !== "ACTIVE") {
    throw new HttpError(
      403,
      "account_inactive",
      "This account cannot sign in.",
    );
  }

  await invalidateSessionToken(previousSessionToken);

  return {
    user: toPublicUser(user),
    session: await createSessionForUser(user.id),
  };
}

export async function logoutSession(sessionToken?: string): Promise<void> {
  requireAuthSecret();
  requireDatabaseConfigured();
  await invalidateSessionToken(sessionToken);
}

export async function invalidateSessionToken(
  sessionToken?: string,
): Promise<void> {
  if (!sessionToken) {
    return;
  }

  const prisma = getPrismaClient();
  await prisma.session.deleteMany({
    where: { tokenHash: hashSessionToken(sessionToken) },
  });
}

export async function resolveSessionUser(
  sessionToken: string | undefined,
): Promise<PublicUser | null> {
  if (!sessionToken) {
    return null;
  }

  requireDatabaseConfigured();
  const prisma = getPrismaClient();
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(sessionToken) },
    include: {
      user: {
        include: { profile: true },
      },
    },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }

  return toPublicUser(session.user);
}

export async function getCurrentUser(
  sessionToken: string | undefined,
): Promise<PublicUser | null> {
  const user = await resolveSessionUser(sessionToken);
  if (!user || user.status !== "ACTIVE") {
    return null;
  }
  return user;
}

export async function requireUser(
  sessionToken: string | undefined,
): Promise<PublicUser> {
  const user = await resolveSessionUser(sessionToken);
  if (!user) {
    throw new HttpError(401, "unauthenticated", "Authentication required.");
  }
  return user;
}

export async function requireActiveUser(
  sessionToken: string | undefined,
): Promise<PublicUser> {
  const user = await requireUser(sessionToken);
  if (user.status !== "ACTIVE") {
    throw new HttpError(
      403,
      "account_inactive",
      "This account cannot perform that action.",
    );
  }
  return user;
}

export async function getOwnProfile(
  sessionToken: string | undefined,
): Promise<PublicProfile> {
  const user = await requireActiveUser(sessionToken);
  return user.profile;
}

export async function updateOwnProfile(
  actorUserId: string,
  targetUserId: string,
  input: ProfileUpdateInput,
): Promise<PublicProfile> {
  requireDatabaseConfigured();
  assertAccountOwner(actorUserId, targetUserId);

  const hasUsername = input.username !== undefined;
  const hasDisplayName = input.displayName !== undefined;
  const hasBio = input.bio !== undefined;
  if (!hasUsername && !hasDisplayName && !hasBio) {
    throw new HttpError(400, "invalid_input", "No profile fields to update.", {
      profile: "Provide at least one field to update.",
    });
  }

  const fields: Record<string, string> = {};
  let username: string | undefined;
  let displayName: string | undefined;
  let bio: string | null | undefined;

  if (hasUsername) {
    const value = readRequiredString(input.username, "username");
    if (!isValidUsername(value)) {
      fields.username =
        "Username must be 3-32 characters and contain only letters, numbers, or underscores.";
    } else {
      username = value.trim();
    }
  }

  if (hasDisplayName) {
    const value = readRequiredString(input.displayName, "displayName");
    if (!isValidDisplayName(value)) {
      fields.displayName = `Display name must be ${identityLimits.displayNameMinLength}-${identityLimits.displayNameMaxLength} characters.`;
    } else {
      displayName = normalizeDisplayName(value);
    }
  }

  if (hasBio) {
    if (input.bio !== null && typeof input.bio !== "string") {
      fields.bio = "Bio must be a string.";
    } else {
      const normalized = normalizeBio(input.bio);
      if (!isValidBio(normalized)) {
        fields.bio = `Bio must be at most ${identityLimits.bioMaxLength} characters.`;
      } else {
        bio = normalized;
      }
    }
  }

  throwIfFields(fields);

  const prisma = getPrismaClient();
  try {
    const profile = await prisma.profile.update({
      where: { userId: targetUserId },
      data: {
        ...(username
          ? {
              username,
              usernameNormalized: normalizeUsername(username),
            }
          : {}),
        ...(displayName !== undefined ? { displayName } : {}),
        ...(bio !== undefined ? { bio } : {}),
      },
    });
    return toPublicProfile(profile);
  } catch (error) {
    throw mapConstraintError(error);
  }
}

export function issueCsrfToken(source: NodeJS.ProcessEnv = process.env): string {
  return createCsrfToken(requireAuthSecret(source));
}

export function serializePublicUser(user: PublicUser) {
  return {
    id: user.id,
    email: user.email,
    status: user.status,
    isModerator: user.isModerator === true,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    profile: serializePublicProfile(user.profile),
  };
}

export function serializePublicProfile(profile: PublicProfile) {
  return {
    id: profile.id,
    userId: profile.userId,
    username: profile.username,
    displayName: profile.displayName,
    bio: profile.bio,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

async function createSessionForUser(userId: string): Promise<IssuedSession> {
  const token = generateSessionToken();
  const expiresAt = sessionExpiryDate();
  const prisma = getPrismaClient();

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt,
    },
  });

  return {
    token,
    expiresAt,
    csrfToken: issueCsrfToken(),
  };
}

function requireDatabaseConfigured(): void {
  if (!loadEnv().databaseUrl) {
    throw new Error(
      "Missing required configuration: DATABASE_URL. PostgreSQL access is unavailable until a connection string is provided. Do not use fake credentials.",
    );
  }
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "invalid_input", "Invalid input.", {
      [field]: `${field} is required.`,
    });
  }
  return value;
}

function throwIfFields(fields: Record<string, string>): void {
  if (Object.keys(fields).length > 0) {
    throw new HttpError(400, "invalid_input", "Invalid input.", fields);
  }
}

function mapConstraintError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    const field = uniqueConstraintField(error);
    if (field === "email") {
      throw new HttpError(409, "conflict", "Email is already registered.", {
        email: "Email is already registered.",
      });
    }
    if (field === "username") {
      throw new HttpError(409, "conflict", "Username is already taken.", {
        username: "Username is already taken.",
      });
    }
    throw new HttpError(409, "conflict", "That value is already in use.");
  }

  throw error;
}

function uniqueConstraintField(
  error: Prisma.PrismaClientKnownRequestError,
): "email" | "username" | undefined {
  const target = error.meta?.target;
  const values = Array.isArray(target)
    ? target.map((entry) => String(entry))
    : typeof target === "string"
      ? [target]
      : [];
  const joined = values.join(" ").toLowerCase();
  if (joined.includes("email")) {
    return "email";
  }
  if (joined.includes("username")) {
    return "username";
  }
  return undefined;
}

let cachedDummyPasswordHash: string | undefined;

async function dummyPasswordHash(): Promise<string> {
  if (!cachedDummyPasswordHash) {
    cachedDummyPasswordHash = await hashPassword(
      "nexus-dummy-password-equalization",
    );
  }
  return cachedDummyPasswordHash;
}
