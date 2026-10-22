import {
  errorResponse,
  jsonResponse,
  protectMutation,
  readJsonObject,
  readSessionToken,
} from "@/lib/auth-http";
import { applyEnforcement } from "@/lib/moderation";

export async function POST(request: Request) {
  try {
    protectMutation(request);
    const body = await readJsonObject(request);
    const action = await applyEnforcement(readSessionToken(request), {
      actionType: body.actionType,
      targetType: body.targetType,
      targetId: body.targetId,
      reason: body.reason,
      reportId: body.reportId,
    });
    return jsonResponse({
      action: {
        id: action.id,
        actionType: action.actionType,
        targetType: action.targetType,
        targetId: action.targetId,
        reportId: action.reportId,
        reason: action.reason,
        outcome: action.outcome,
        createdAt: action.createdAt.toISOString(),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
