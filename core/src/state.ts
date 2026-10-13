import { appendFile, rename } from "node:fs/promises";
import { join } from "node:path";

export type State = "extracting" | "transcribing" | "muxing" | "pending" | "done" | "error";

export type Status = {
  id: string;
  state: State;
  inputPath: string;
  videoUri: string;
  message: string;
  updatedAt: string;
};

export async function writeStatus(stateDir: string, status: Omit<Status, "updatedAt">) {
  const path = join(stateDir, "status.json");
  const temp = `${path}.tmp`;
  await Bun.write(temp, JSON.stringify({ ...status, updatedAt: new Date().toISOString() }));
  await rename(temp, path);
}

export async function log(stateDir: string, line: string) {
  await appendFile(join(stateDir, "log.txt"), `${new Date().toISOString()} ${line}\n`);
}
