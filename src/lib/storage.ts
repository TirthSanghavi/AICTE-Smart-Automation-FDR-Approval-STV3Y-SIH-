import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const STORE_ROOT = path.resolve(process.cwd(), process.env.FILE_STORE_PATH ?? ".data/uploads");

function safeKey(key: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(key)) throw new Error("INVALID_STORAGE_KEY");
  const resolved = path.resolve(STORE_ROOT, key);
  if (!resolved.startsWith(STORE_ROOT + path.sep)) throw new Error("INVALID_STORAGE_KEY");
  return resolved;
}

export function newStorageKey(extension: string): string {
  return `${randomUUID()}.${extension.replace(/[^a-z0-9]/gi, "")}`;
}

export async function saveBytes(key: string, bytes: Buffer): Promise<void> {
  await mkdir(STORE_ROOT, { recursive: true });
  await writeFile(safeKey(key), bytes, { flag: "wx" });
}

export async function readBytes(key: string): Promise<Buffer> {
  return readFile(safeKey(key));
}

export async function removeBytes(key: string): Promise<void> {
  try {
    await unlink(safeKey(key));
  } catch {
    // Already gone: cleanup must not mask the original failure.
  }
}

export function storageRoot(): string {
  return STORE_ROOT;
}
