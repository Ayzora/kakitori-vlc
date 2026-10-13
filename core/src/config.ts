import { join } from "node:path";
import { Refusal } from "./refusal.ts";

export async function loadApiKey(stateDir: string, env: Record<string, string | undefined>): Promise<string> {
  if (env.ELEVENLABS_API_KEY) return env.ELEVENLABS_API_KEY;
  let apiKey: unknown;
  try {
    apiKey = JSON.parse(await Bun.file(join(stateDir, "config.json")).text()).apiKey;
  } catch {}
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Refusal("No API key saved. Use Change API key.");
  return apiKey.trim();
}
