// One Transcription at a time: a lock file in the state folder holding the
// running core's process ID. A lock whose process has ended is stale.

import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const lockPath = (stateDir: string) => join(stateDir, "kakitori.lock");

export async function acquireLock(stateDir: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // node:fs rather than Bun.write: only it can create a file exclusively
      // ("wx" fails if the file already exists), which makes taking the lock atomic.
      await writeFile(lockPath(stateDir), String(process.pid), { flag: "wx" });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(await Bun.file(lockPath(stateDir)).text().catch(() => ""));
      if (isRunning(pid)) return false;
      await rm(lockPath(stateDir), { force: true });
    }
  }
  return false;
}

export async function releaseLock(stateDir: string) {
  await rm(lockPath(stateDir), { force: true });
}

function isRunning(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
