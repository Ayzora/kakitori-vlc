// Replaces the Video with its checked working copy.

import { chmod, rename, stat, utimes } from "node:fs/promises";

// Windows refuses to replace a file another program (e.g. VLC) has open.
const LOCKED = new Set(["EPERM", "EBUSY", "EACCES"]);

export type SwapResult = "swapped" | "locked";

export async function swapIn(copy: string, video: string): Promise<SwapResult> {
  const before = await stat(video);
  try {
    await rename(copy, video);
  } catch (error) {
    if (LOCKED.has((error as NodeJS.ErrnoException).code ?? "")) return "locked";
    throw error;
  }
  // Done after the rename, so a Pending copy is always newer than its Video.
  await utimes(video, before.atime, before.mtime);
  if (process.platform !== "win32") await chmod(video, before.mode & 0o7777);
  return "swapped";
}
