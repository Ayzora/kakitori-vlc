// Replaces the Video with its checked working copy.

import { chmod, rename, stat, utimes } from "node:fs/promises";

const RETRY_MS = 5000;
const RETRY_FOR_MS = 2 * 60 * 1000;

// Windows refuses to replace a file another program (e.g. VLC) has open.
const LOCKED = new Set(["EPERM", "EBUSY", "EACCES"]);

export type SwapResult = "swapped" | "locked";

export async function swapIn(
  copy: string,
  video: string,
  wait: (ms: number) => Promise<void>,
  onLocked: () => Promise<void>,
): Promise<SwapResult> {
  const before = await stat(video);
  for (let waited = 0; ; waited += RETRY_MS) {
    try {
      await rename(copy, video);
      break;
    } catch (error) {
      if (!LOCKED.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
      if (waited >= RETRY_FOR_MS) return "locked";
      if (waited === 0) await onLocked();
      await wait(RETRY_MS);
    }
  }
  // Done after the rename, so a Pending copy is always newer than its Video.
  await utimes(video, before.atime, before.mtime);
  if (process.platform !== "win32") await chmod(video, before.mode & 0o7777);
  return "swapped";
}
