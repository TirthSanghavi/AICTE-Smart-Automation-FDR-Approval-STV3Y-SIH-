import { prisma } from "./db";
import { todayInIST } from "./dates";

export function demoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

export function testClockEnabled(): boolean {
  return demoMode() && process.env.TEST_CLOCK_ENABLED === "true";
}

/** Today's date for scheduling. In demo mode a frozen date can override it. */
export async function getToday(): Promise<Date> {
  if (!testClockEnabled()) return todayInIST();
  const state = await prisma.demoState.findUnique({ where: { id: "singleton" } });
  return state?.demoDate ?? todayInIST();
}

export async function getDemoState(): Promise<{ demoDate: Date | null; frozen: boolean }> {
  if (!testClockEnabled()) return { demoDate: null, frozen: false };
  const state = await prisma.demoState.findUnique({ where: { id: "singleton" } });
  return { demoDate: state?.demoDate ?? null, frozen: !!state?.demoDate };
}

export async function setDemoDate(date: Date | null): Promise<void> {
  await prisma.demoState.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", demoDate: date },
    update: { demoDate: date },
  });
}
