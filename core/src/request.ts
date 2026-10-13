import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./state.ts";
import type { TranscriptionRequest } from "./transcription.ts";

export async function takeRequest(stateDir: string): Promise<TranscriptionRequest | null> {
  const path = join(stateDir, "job.json");
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const text = await file.text();
  await rm(path, { force: true });
  try {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
    const videoUri = String(parsed.videoUri);
    return {
      id: String(parsed.id ?? crypto.randomUUID()),
      videoPath: fileURLToPath(videoUri),
      videoUri,
      replace: parsed.replace === true,
    };
  } catch (error) {
    await log(stateDir, `ignoring unreadable job.json: ${error}`);
    return null;
  }
}
