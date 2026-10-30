import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { roleOf, type Role } from "./constants";
import { sha256Hex } from "./audit";
import { hashPassword, verifyPassword } from "./password";

export { hashPassword, verifyPassword };

export const SESSION_COOKIE = "fdr_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  institutionId: string | null;
  institutionName: string | null;
};

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export function newSessionToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: sha256Hex(token),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  };
}

export async function createSession(userId: string): Promise<void> {
  const session = newSessionToken();
  await prisma.session.create({
    data: { userId, tokenHash: session.tokenHash, expiresAt: session.expiresAt },
  });
  await setSessionCookie(session.token, session.expiresAt);
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
  }
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: { include: { institution: true } } },
  });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  if (session.user.status !== "ACTIVE") return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: roleOf(session.user.role),
    institutionId: session.user.institutionId,
    institutionName: session.user.institution?.name ?? null,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireInstitutionUser(): Promise<SessionUser & { institutionId: string }> {
  const user = await requireUser();
  if (!user.institutionId) redirect("/");
  return { ...user, institutionId: user.institutionId };
}
