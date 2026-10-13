// The Transcription runner: one Transcription from its request to the notification.

import { existsSync } from "node:fs";
import { mkdtemp, rm, stat, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { extractAudio } from "./audio.ts";
import { loadApiKey } from "./config.ts";
import { acquireLock, releaseLock } from "./lock.ts";
import { checkCopy, makeWorkingCopy } from "./mux.ts";
import { Refusal } from "./refusal.ts";
import { transcribe, type Fetch } from "./scribe.ts";
import { buildSrt } from "./srt.ts";
import { log, writeStatus, type State } from "./state.ts";
import { swapIn } from "./swap.ts";
import { hasSubtitleTrack, inspect, japaneseAudioIndex, streamsOfType, type VideoInfo } from "./video.ts";

// videoUri is how VLC names the Video; the extension reopens it by that name.
// replace: the user asked to transcribe again, so a Video that already has a
// Subtitle track gets a new one in its place instead of being turned away.
export type TranscriptionRequest = { id: string; videoPath: string; videoUri: string; replace: boolean };

// Everything outside the core that a Transcription touches.
export type World = {
  stateDir: string;
  ffmpeg: string;
  ffprobe: string;
  env: Record<string, string | undefined>;
  fetch: Fetch;
  wait: (ms: number) => Promise<void>;
  // A notification that fades away on its own.
  notify: (message: string) => Promise<void>;
};

// "pending": the Video was in use, so the finished copy is kept as a Pending
// copy until the extension's Reload video stops playback and starts the core again.
export type Outcome = { kind: "done" | "already-subtitled" | "pending" | "error"; message: string };

type ReportState = (state: State) => Promise<void>;

const SUPPORTED = new Set([".mp4", ".m4v", ".mov"]);
const MAX_SECONDS = 10 * 60 * 60;
const MAX_UPLOAD_BYTES = 3 * 1024 ** 3;

export async function runTranscription(request: TranscriptionRequest, world: World): Promise<Outcome> {
  const status = (state: State, message = "") =>
    writeStatus(world.stateDir, {
      id: request.id,
      state,
      inputPath: request.videoPath,
      videoUri: request.videoUri,
      message,
    });

  await log(world.stateDir, `[${request.id}] start ${request.videoPath}`);
  if (!(await acquireLock(world.stateDir))) {
    // The running Transcription owns status.json, so it is left alone.
    const outcome: Outcome = { kind: "error", message: "A transcription is already running." };
    await log(world.stateDir, `[${request.id}] ${outcome.message}`);
    await showNotification(world, request.id, outcome.message);
    return outcome;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "kakitori-"));
  let outcome: Outcome;
  try {
    outcome = await transcribeVideo(request.videoPath, request.replace, world, tempDir, status);
  } catch (error) {
    await log(world.stateDir, `[${request.id}] failed: ${describe(error)}`);
    const message = error instanceof Refusal ? error.message : "Something went wrong. See the log for details.";
    outcome = { kind: "error", message };
  }
  try {
    await rm(tempDir, { recursive: true, force: true });
    await status(FINAL_STATE[outcome.kind], outcome.message);
  } finally {
    await releaseLock(world.stateDir);
  }
  await log(world.stateDir, `[${request.id}] ${outcome.kind}${outcome.message ? `: ${outcome.message}` : ""}`);
  // Last of all, once the status is final and the lock released.
  await showNotification(world, request.id, notification(outcome));
  return outcome;
}

// A new Subtitle track only shows once VLC opens the Video again, which the
// user starts from the Kakitori window.
function notification(outcome: Outcome) {
  if (outcome.kind === "done") return `${outcome.message}. Open Kakitori and click Reload video.`;
  if (outcome.kind === "pending") return "The subtitles are ready. Open Kakitori and click Reload video to add them.";
  return outcome.message;
}

// A notification that fails to show is only logged: the result is in the status.
async function showNotification(world: World, id: string, message: string) {
  try {
    await world.notify(message);
  } catch (error) {
    await log(world.stateDir, `[${id}] notification failed: ${describe(error)}`);
  }
}

const FINAL_STATE: Record<Outcome["kind"], State> = {
  done: "done",
  "already-subtitled": "done",
  pending: "pending",
  error: "error",
};

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause === undefined ? "" : `\n  cause: ${describe(error.cause)}`;
  return `${error.stack ?? error.message}${cause}`;
}

async function transcribeVideo(
  videoPath: string,
  replace: boolean,
  world: World,
  tempDir: string,
  status: ReportState,
): Promise<Outcome> {
  const name = basename(videoPath);
  if (!existsSync(videoPath)) throw new Refusal("The video file can't be found.");
  if (!SUPPORTED.has(extname(videoPath).toLowerCase())) {
    throw new Refusal("Subtitles can't be added to this file type.");
  }
  const video = await inspect(world.ffprobe, videoPath);
  if (streamsOfType(video, "audio").length === 0) throw new Refusal("No audio track found.");
  const subtitled = hasSubtitleTrack(video);
  if (subtitled && !replace) {
    return { kind: "already-subtitled", message: `Japanese subtitles are already in ${name}` };
  }
  // Only a Video that has a Subtitle track has one to replace.
  replace = subtitled;
  // Before the free-space check: swapping a Pending copy in needs no new
  // space, and the Pending copy itself takes some.
  const copyPath = workingCopyPath(videoPath);
  const pending = await usablePendingCopy(world, videoPath, video, copyPath, replace);
  if (pending) {
    await status("muxing");
    return swapOrKeep(copyPath, videoPath, added(name, pending.dataRemoved, replace));
  }

  await checkFreeSpace(videoPath);
  if (video.duration > MAX_SECONDS) throw new Refusal("ElevenLabs can't transcribe videos longer than 10 hours.");
  const apiKey = await loadApiKey(world.stateDir, world.env);

  await status("extracting");
  const audio = join(tempDir, "audio.m4a");
  await extractAudio(world.ffmpeg, videoPath, japaneseAudioIndex(video), audio);
  if ((await stat(audio)).size > MAX_UPLOAD_BYTES) {
    throw new Refusal("The audio is larger than ElevenLabs' 3 GB upload limit.");
  }

  await status("transcribing");
  const words = await transcribe(world.fetch, world.wait, apiKey, audio);
  const srt = join(tempDir, "subtitles.srt");
  await Bun.write(srt, buildSrt(words));

  await status("muxing");
  const made = await makeWorkingCopy(world, videoPath, video, srt, copyPath, replace);
  return swapOrKeep(copyPath, videoPath, added(name, made.dataRemoved, replace));
}

function added(name: string, dataRemoved: boolean, replaced: boolean): Outcome {
  const message = replaced ? `Japanese subtitles replaced in ${name}` : `Japanese subtitles added to ${name}`;
  return { kind: "done", message: dataRemoved ? `${message}. Some extra camera data was removed.` : message };
}

// A Pending copy left by an earlier locked swap is used when it passes the
// check against the Video and is newer than it. Anything else in its place is
// stale or incomplete and is deleted.
async function usablePendingCopy(world: World, videoPath: string, video: VideoInfo, copyPath: string, replace: boolean) {
  if (!existsSync(copyPath)) return null;
  try {
    const [check, copyStat, videoStat] = await Promise.all([
      checkCopy(world.ffprobe, video, copyPath, true, replace),
      stat(copyPath),
      stat(videoPath),
    ]);
    if (check.complete && copyStat.mtimeMs > videoStat.mtimeMs) return check;
  } catch {}
  await log(world.stateDir, `deleting unusable Pending copy ${copyPath}`);
  await rm(copyPath, { force: true });
  return null;
}

// Replaces the Video with the checked copy. If the Video is in use (Windows
// won't replace a file VLC is playing), the copy is kept as a Pending copy.
async function swapOrKeep(copyPath: string, videoPath: string, added: Outcome): Promise<Outcome> {
  let swapped;
  try {
    swapped = await swapIn(copyPath, videoPath);
  } catch (error) {
    await rm(copyPath, { force: true });
    throw error;
  }
  if (swapped === "locked") {
    return { kind: "pending", message: "The subtitles are ready. Click Reload video to add them." };
  }
  return added;
}

// The working copy needs as much room as the Video itself.
async function checkFreeSpace(videoPath: string) {
  const [disk, file] = await Promise.all([statfs(dirname(videoPath)), stat(videoPath)]);
  if (disk.bavail * disk.bsize < file.size) throw new Refusal("Not enough free space next to the video.");
}

function workingCopyPath(videoPath: string) {
  const ext = extname(videoPath);
  return join(dirname(videoPath), `${basename(videoPath, ext)}.kakitori.tmp${ext}`);
}
