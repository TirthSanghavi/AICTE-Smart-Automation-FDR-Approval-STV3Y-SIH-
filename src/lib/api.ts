import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { AppError, forbidden, unauthorized } from "./errors";
import { getCurrentUser, type SessionUser } from "./auth";
import { recordDeniedAccess } from "./audit";
import type { Role } from "./constants";

export function requestIdFor(request?: Request): string {
  return request?.headers.get("x-request-id") ?? `req_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export async function requireApiUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  if (roles && !roles.includes(user.role)) {
    throw forbidden("api_route", roles.join("|"));
  }
  return user;
}

/** Rejects cross-origin mutations. Requests without an Origin header (curl, tests) pass. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("host");
  try {
    const originUrl = new URL(origin);
    if (!host || originUrl.host !== host) {
      throw forbidden("origin", originUrl.host);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw forbidden("origin", "invalid");
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError(400, "MALFORMED_JSON", "Send a valid JSON request body.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError(400, "MALFORMED_JSON", "Send a JSON object request body.");
  }
  return body as Record<string, unknown>;
}

export function requiredString(
  body: Record<string, unknown>,
  key: string,
  label = key,
  max = 500,
): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new AppError(422, "VALIDATION_FAILED", `${label} is required.`, {
      details: [{ field: key, issue: `${label} is required.` }],
    });
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new AppError(422, "VALIDATION_FAILED", `${label} is too long.`, {
      details: [{ field: key, issue: `Use ${max} characters or fewer.` }],
    });
  }
  return trimmed;
}

export function optionalString(
  body: Record<string, unknown>,
  key: string,
  max = 1000,
): string | null {
  const value = body[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  return value.trim().slice(0, max) || null;
}

export function stringArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value) return [value];
  return [];
}

export function apiErrorPayload(error: unknown, requestId: string) {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details ? { details: error.details } : {}),
        },
      },
    };
  }
  console.error(`[api:${requestId}]`, error);
  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. No changes were saved.",
        requestId,
      },
    },
  };
}

/** Wraps a route handler with the standard contract and denied-access auditing. */
export async function withApi(
  request: Request,
  fn: () => Promise<Response>,
): Promise<Response> {
  const requestId = requestIdFor(request);
  try {
    const response = await fn();
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) {
    const payload = apiErrorPayload(error, requestId);
    if (error instanceof AppError && error.status === 403) {
      try {
        const user = await getCurrentUser();
        if (user && error.auditEntity) {
          await recordDeniedAccess({
            actorId: user.id,
            actorRole: user.role,
            entityType: error.auditEntity.type,
            entityId: error.auditEntity.id,
          });
        }
      } catch {
        // Never let security logging mask the original denial.
      }
    }
    return NextResponse.json(payload.body, {
      status: payload.status,
      headers: { "x-request-id": requestId },
    });
  }
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}
