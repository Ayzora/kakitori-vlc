// The Transcription runner: one Transcription from its request to the popup.

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

// videoPath null: the user picks the Video in the file picker, then confirms it.
export type TranscriptionRequest = { id: string; videoPath: string | null };

// Everything outside the core that a Transcription touches.
export type World = {
  stateDir: string;
  ffmpeg: string;
  ffprobe: string;
  env: Record<string, string | undefined>;
  fetch: Fetch;
  popup: (message: string) => Promise<void>;
  wait: (ms: number) => Promise<void>;
  // The system file picker; null when the user cancels.
  chooseVideo: () => Promise<string | null>;
  // A Start / Cancel question; true for Start.
  confirm: (question: string) => Promise<boolean>;
};

export type Outcome = { kind: "done" | "already-subtitled" | "cancelled" | "error"; message: string };

type ReportState = (state: State) => Promise<void>;

const SUPPORTED = new Set([".mp4", ".m4v", ".mov"]);
const MAX_SECONDS = 10 * 60 * 60;
const MAX_UPLOAD_BYTES = 3 * 1024 ** 3;

export async function runTranscription(request: TranscriptionRequest, world: World): Promise<Outcome> {
  let videoPath = request.videoPath ?? "";
  const status = (state: State, message = "") =>
    writeStatus(world.stateDir, { id: request.id, state, inputPath: videoPath, message });

  await log(world.stateDir, `[${request.id}] start ${request.videoPath ?? "(file picker)"}`);
  if (!(await acquireLock(world.stateDir))) {
    // The running Transcription owns status.json, so it is left alone.
    const outcome: Outcome = { kind: "error", message: "A transcription is already running." };
    await log(world.stateDir, `[${request.id}] ${outcome.message}`);
    await showPopup(world, request.id, outcome.message);
    return outcome;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "kakitori-"));
  let outcome: Outcome;
  try {
    if (request.videoPath === null) {
      const chosen = await world.chooseVideo();
      if (chosen) await log(world.stateDir, `[${request.id}] chose ${chosen}`);
      videoPath = chosen ?? "";
    }
    outcome = videoPath
      ? await transcribeVideo(videoPath, world, tempDir, status, request.videoPath === null)
      : { kind: "cancelled", message: "" };
  } catch (error) {
    await log(world.stateDir, `[${request.id}] failed: ${describe(error)}`);
    const message = error instanceof Refusal ? error.message : "Something went wrong. See the log for details.";
    outcome = { kind: "error", message };
  }
  try {
    await rm(tempDir, { recursive: true, force: true });
    // A cancelled Transcription leaves the last status as it was.
    if (outcome.kind !== "cancelled") await status(outcome.kind === "error" ? "error" : "done", outcome.message);
  } finally {
    await releaseLock(world.stateDir);
  }
  await log(world.stateDir, `[${request.id}] ${outcome.kind}${outcome.message ? `: ${outcome.message}` : ""}`);
  // Last of all: a popup nobody clicks must not hold anything up.
  if (outcome.kind !== "cancelled") await showPopup(world, request.id, outcome.message);
  return outcome;
}

async function showPopup(world: World, id: string, message: string) {
  try {
    await world.popup(message);
  } catch (error) {
    await log(world.stateDir, `[${id}] popup failed: ${describe(error)}`);
  }
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause === undefined ? "" : `\n  cause: ${describe(error.cause)}`;
  return `${error.stack ?? error.message}${cause}`;
}

async function transcribeVideo(
  videoPath: string,
  world: World,
  tempDir: string,
  status: ReportState,
  askFirst: boolean,
): Promise<Outcome> {
  const name = basename(videoPath);
  if (!existsSync(videoPath)) throw new Refusal("The video file can't be found.");
  if (!SUPPORTED.has(extname(videoPath).toLowerCase())) {
    throw new Refusal("Subtitles can't be added to this file type.");
  }
  const video = await inspect(world.ffprobe, videoPath);
  if (streamsOfType(video, "audio").length === 0) throw new Refusal("No audio track found.");
  if (hasSubtitleTrack(video)) {
    return { kind: "already-subtitled", message: `Japanese subtitles are already in ${name}` };
  }
  // Nothing is uploaded or billed before the user has seen the name and length.
  if (askFirst && !(await world.confirm(`Transcribe ${name} (${formatLength(video.duration)})?`))) {
    return { kind: "cancelled", message: "" };
  }

  // Before the free-space check: swapping a Pending copy in needs no new
  // space, and the Pending copy itself takes some.
  const copyPath = workingCopyPath(videoPath);
  const pending = await usablePendingCopy(world, videoPath, video, copyPath);
  if (pending) {
    await status("muxing");
    await swapOrKeep(copyPath, videoPath, world, status);
    return added(name, pending.dataRemoved);
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
  const made = await makeWorkingCopy(world, videoPath, video, srt, copyPath);
  await swapOrKeep(copyPath, videoPath, world, status);
  return added(name, made.dataRemoved);
}

function added(name: string, dataRemoved: boolean): Outcome {
  const message = `Japanese subtitles added to ${name}`;
  return { kind: "done", message: dataRemoved ? `${message}. Some extra camera data was removed.` : message };
}

// A Pending copy left by an earlier locked swap is used when it passes the
// check against the Video and is newer than it. Anything else in its place is
// stale or incomplete and is deleted.
async function usablePendingCopy(world: World, videoPath: string, video: VideoInfo, copyPath: string) {
  if (!existsSync(copyPath)) return null;
  try {
    const [check, copyStat, videoStat] = await Promise.all([
      checkCopy(world.ffprobe, video, copyPath, true),
      stat(copyPath),
      stat(videoPath),
    ]);
    if (check.complete && copyStat.mtimeMs > videoStat.mtimeMs) return check;
  } catch {}
  await log(world.stateDir, `deleting unusable Pending copy ${copyPath}`);
  await rm(copyPath, { force: true });
  return null;
}

// Replaces the Video with the checked copy. If the Video stays locked, the
// copy is kept as a Pending copy for the next Transcription.
async function swapOrKeep(copyPath: string, videoPath: string, world: World, status: ReportState) {
  let swapped;
  try {
    swapped = await swapIn(copyPath, videoPath, world.wait, () => status("waiting-for-unlock"));
  } catch (error) {
    await rm(copyPath, { force: true });
    throw error;
  }
  if (swapped === "locked") throw new Refusal("Close the video in VLC, then click Transcribe again.");
}

// The working copy needs as much room as the Video itself.
async function checkFreeSpace(videoPath: string) {
  const [disk, file] = await Promise.all([statfs(dirname(videoPath)), stat(videoPath)]);
  if (disk.bavail * disk.bsize < file.size) throw new Refusal("Not enough free space next to the Video.");
}

function workingCopyPath(videoPath: string) {
  const ext = extname(videoPath);
  return join(dirname(videoPath), `${basename(videoPath, ext)}.kakitori.tmp${ext}`);
}

// 0:03, 12:05, 1:02:05
function formatLength(seconds: number) {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  const ss = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
