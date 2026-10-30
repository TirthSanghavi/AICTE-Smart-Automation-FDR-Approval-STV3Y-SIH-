export type ErrorDetail = { field?: string; issue: string };

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetail[];
  readonly auditEntity?: { type: string; id: string };

  constructor(
    status: number,
    code: string,
    message: string,
    options?: { details?: ErrorDetail[]; auditEntity?: { type: string; id: string } },
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = options?.details;
    this.auditEntity = options?.auditEntity;
  }
}

export const unauthorized = () =>
  new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");

export const forbidden = (entityType = "unknown", entityId = "unknown") =>
  new AppError(403, "FORBIDDEN", "You do not have permission for this action.", {
    auditEntity: { type: entityType, id: entityId },
  });

export const notFound = () =>
  new AppError(404, "NOT_FOUND", "The requested record was not found.");

export const invalid = (message: string, details?: ErrorDetail[]) =>
  new AppError(422, "VALIDATION_FAILED", message, { details });

export const conflict = (code: string, message: string, details?: ErrorDetail[]) =>
  new AppError(409, code, message, { details });
