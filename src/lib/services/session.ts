import { prisma } from "../db";
import { appendAudit, auditTransaction } from "../audit";
import { AppError } from "../errors";
import {
  destroySession,
  getCurrentUser,
  newSessionToken,
  setSessionCookie,
  verifyPassword,
} from "../auth";
import { roleOf } from "../constants";

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const GENERIC_LOGIN_ERROR = "Email or password is incorrect.";

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || user.status !== "ACTIVE") {
    throw new AppError(401, "INVALID_CREDENTIALS", GENERIC_LOGIN_ERROR);
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw new AppError(
      429,
      "ACCOUNT_LOCKED",
      "Too many failed attempts. Try again in a few minutes or use another demo account.",
    );
  }

  const valid = verifyPassword(password, user.passwordHash);
  if (!valid) {
    const failedLogins = user.failedLogins + 1;
    const locked = failedLogins >= MAX_FAILED;
    await auditTransaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLogins: locked ? 0 : failedLogins,
          lockedUntil: locked ? new Date(Date.now() + LOCK_MS) : user.lockedUntil,
        },
      });
      await appendAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: "auth.login_failed",
        entityType: "user",
        entityId: user.id,
        after: { failedLogins: locked ? 0 : failedLogins, locked },
      });
    });
    throw new AppError(401, "INVALID_CREDENTIALS", GENERIC_LOGIN_ERROR);
  }

  const session = newSessionToken();
  await auditTransaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });
    await tx.session.create({
      data: {
        userId: user.id,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
      },
    });
    await appendAudit(tx, {
      actorId: user.id,
      actorRole: user.role,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
    });
  });
  await setSessionCookie(session.token, session.expiresAt);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: roleOf(user.role),
    institutionId: user.institutionId,
    institutionName: null,
  };
}

export async function logout() {
  const user = await getCurrentUser();
  if (user) {
    await auditTransaction(async (tx) => {
      await tx.session.deleteMany({ where: { userId: user.id } });
      await appendAudit(tx, {
        actorId: user.id,
        actorRole: user.role,
        action: "auth.logout",
        entityType: "user",
        entityId: user.id,
      });
    });
  }
  await destroySession();
}
