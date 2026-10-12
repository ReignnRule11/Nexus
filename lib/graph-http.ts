import "server-only";

import { getCurrentUser } from "@/lib/auth";
import { readSessionToken } from "@/lib/auth-http";

export async function readViewerId(
  request: Request,
): Promise<string | undefined> {
  const user = await getCurrentUser(readSessionToken(request));
  return user?.id;
}
