import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Where request photos live. The M3 adapter writes to local disk; a cloud store
 * can replace it later without touching the services that call put and get.
 */
export interface PhotoStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

const KEY_RE = /^[A-Za-z0-9_.-]{1,120}$/;

/** A storage key is a bare file name: no separators, no parent references. */
export function safeKey(key: string): string {
  if (!KEY_RE.test(key) || key.includes("..")) throw new Error("Invalid photo key.");
  return key;
}

export function createLocalPhotoStore(dir: string): PhotoStore {
  return {
    async put(key, bytes) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, safeKey(key)), bytes, { flag: "w" });
    },
    async get(key) {
      try {
        return await readFile(join(dir, safeKey(key)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
  };
}

export const photoStore: PhotoStore = createLocalPhotoStore(process.env.UPLOAD_DIR ?? ".uploads");
