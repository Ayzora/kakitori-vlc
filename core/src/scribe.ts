// ElevenLabs Scribe v2 client. The request is the one from the Kakitori web
// app's transcribe route; the key comes from Config.

import { Refusal } from "./refusal.ts";
import type { Word } from "./srt.ts";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const TIMEOUT_MS = 15 * 60 * 1000;
// Waits before each retry of a connection failure or server error.
const BACKOFF_MS = [2000, 4000, 8000];

export async function transcribe(
  fetch: Fetch,
  wait: (ms: number) => Promise<void>,
  apiKey: string,
  audioPath: string,
): Promise<Word[]> {
  for (let attempt = 0; ; attempt++) {
    const result = await attemptOnce(fetch, apiKey, audioPath);
    if ("words" in result) return result.words;
    const delay = BACKOFF_MS[attempt];
    if (!result.retry || delay === undefined) throw result.failure;
    await wait(delay);
  }
}

type Attempt = { words: Word[] } | { failure: Error; retry: boolean };

async function attemptOnce(fetch: Fetch, apiKey: string, audioPath: string): Promise<Attempt> {
  const form = new FormData();
  form.set("model_id", "scribe_v2");
  form.set("language_code", "jpn");
  form.set("diarize", "false");
  form.set("tag_audio_events", "false");
  form.set("timestamps_granularity", "word");
  form.set("file", Bun.file(audioPath), "audio.m4a");

  let response: Response;
  let text: string;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await response.text();
  } catch (error) {
    // A timed-out request may still be billed, so it is never retried.
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return { failure: new Refusal("ElevenLabs took too long. Try again later."), retry: false };
    }
    return {
      failure: new Refusal("Couldn't reach ElevenLabs. Check your internet connection.", { cause: error }),
      retry: true,
    };
  }

  if (response.ok) return { words: JSON.parse(text).words };
  const cause = new Error(`ElevenLabs answered ${response.status}: ${text}`);
  if (response.status === 401) {
    return { failure: new Refusal("API key rejected. Use Change API key.", { cause }), retry: false };
  }
  if (response.status >= 500) {
    return { failure: new Refusal("ElevenLabs had a problem. Try again later.", { cause }), retry: true };
  }
  return { failure: new Refusal(elevenLabsMessage(text), { cause }), retry: false };
}

// ElevenLabs' own one-line explanation, e.g. {"detail":{"message":"..."}}.
function elevenLabsMessage(text: string): string {
  let message = text;
  try {
    const detail = JSON.parse(text).detail;
    message = typeof detail === "string" ? detail : (detail?.message ?? text);
  } catch {}
  const line = message.split("\n")[0]!.trim();
  return line ? line.slice(0, 300) : "ElevenLabs refused the request.";
}
