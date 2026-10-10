import { getDatabaseHealth } from "@/lib/db-health";

export async function GET() {
  const result = await getDatabaseHealth();
  return Response.json(result.body, { status: result.httpStatus });
}
