// The files the core keeps in the state folder: status.json and log.txt.

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

// Written to a temporary file and renamed, so the extension never reads half a file.
export async function writeStatus(stateDir: string, status: Omit<Status, "updatedAt">) {
  const path = join(stateDir, "status.json");
  const temp = `${path}.tmp`;
  await Bun.write(temp, JSON.stringify({ ...status, updatedAt: new Date().toISOString() }));
  await rename(temp, path);
}

// Append-only log of every Transcription. Callers never pass the API key.
export async function log(stateDir: string, line: string) {
  await appendFile(join(stateDir, "log.txt"), `${new Date().toISOString()} ${line}\n`);
}
