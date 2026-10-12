// The Transcription runner: one run from a request to the popup.

import { existsSync } from "node:fs";
import { mkdtemp, rm, stat, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { runProcess } from "./process.ts";
import { Refusal } from "./refusal.ts";
import { transcribe, type Fetch } from "./scribe.ts";
import { buildSrt } from "./srt.ts";
import { acquireLock, releaseLock } from "./lock.ts";
import { dataRemoved, isCompleteCopy, makeWorkingCopy } from "./mux.ts";
import { log, writeStatus, type State } from "./state.ts";
import { swapIn } from "./swap.ts";
import { hasSubtitleTrack, inspect, japaneseAudioIndex, streamsOfType, type VideoInfo } from "./video.ts";

export type { Fetch };

export type TranscriptionRequest = { id: string; videoPath: string };

// Everything outside the core that a Transcription touches.
export type World = {
  stateDir: string;
  ffmpeg: string;
  ffprobe: string;
  env: Record<string, string | undefined>;
  fetch: Fetch;
  popup: (message: string) => Promise<void>;
  wait: (ms: number) => Promise<void>;
};

export type Outcome = { kind: "done" | "error"; message: string };

const SUPPORTED = new Set([".mp4", ".m4v", ".mov"]);
const MAX_SECONDS = 10 * 60 * 60;
const MAX_UPLOAD_BYTES = 3 * 1024 ** 3;

export async function runTranscription(request: TranscriptionRequest, world: World): Promise<Outcome> {
  const video = request.videoPath;
  const status = (state: State, message = "") =>
    writeStatus(world.stateDir, { id: request.id, state, inputPath: video, message });

  await log(world.stateDir, `[${request.id}] start ${video}`);
  if (!(await acquireLock(world.stateDir))) {
    // The running Transcription owns status.json, so it is left alone.
    const outcome: Outcome = { kind: "error", message: "A transcription is already running." };
    await log(world.stateDir, `[${request.id}] ${outcome.message}`);
    await showPopup(world, request.id, outcome.message);
    return outcome;
  }

  const work = await mkdtemp(join(tmpdir(), "kakitori-"));
  let outcome: Outcome;
  try {
    const message = await transcribeVideo(video, world, work, status);
    outcome = { kind: "done", message };
  } catch (error) {
    await log(world.stateDir, `[${request.id}] failed: ${describe(error)}`);
    const message = error instanceof Refusal ? error.message : "Something went wrong. See the log for details.";
    outcome = { kind: "error", message };
  }
  try {
    await rm(work, { recursive: true, force: true });
    await status(outcome.kind, outcome.message);
  } finally {
    await releaseLock(world.stateDir);
  }
  await log(world.stateDir, `[${request.id}] ${outcome.kind}: ${outcome.message}`);
  // Last of all: a popup nobody clicks must not hold anything up.
  await showPopup(world, request.id, outcome.message);
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
  video: string,
  world: World,
  work: string,
  status: (state: State) => Promise<void>,
): Promise<string> {
  const name = basename(video);
  if (!existsSync(video)) throw new Refusal("The video file can't be found.");
  if (!SUPPORTED.has(extname(video).toLowerCase())) throw new Refusal("Subtitles can't be added to this file type.");
  const info = await inspect(world.ffprobe, video);
  if (streamsOfType(info, "audio").length === 0) throw new Refusal("No audio track found.");
  if (hasSubtitleTrack(info)) return `Japanese subtitles are already in ${name}`;

  const copy = workingCopyPath(video);
  const pending = await usablePendingCopy(world, video, info, copy);
  if (pending) {
    await status("muxing");
    await swapOrKeep(copy, video, world, status);
    return addedMessage(name, pending.dataRemoved);
  }

  await checkFreeSpace(video);
  if (info.duration > MAX_SECONDS) throw new Refusal("ElevenLabs can't transcribe videos longer than 10 hours.");

  const apiKey = await loadApiKey(world);

  await status("extracting");
  const audio = join(work, "audio.m4a");
  await extractAudio(world.ffmpeg, video, japaneseAudioIndex(info), audio);
  if ((await stat(audio)).size > MAX_UPLOAD_BYTES) {
    throw new Refusal("The audio is larger than ElevenLabs' 3 GB upload limit.");
  }

  await status("transcribing");
  const words = await transcribe(world.fetch, world.wait, apiKey, audio);
  const srt = join(work, "subtitles.srt");
  await Bun.write(srt, buildSrt(words));

  await status("muxing");
  const workingCopy = await makeWorkingCopy(world.ffmpeg, world.ffprobe, video, info, srt, copy);
  await swapOrKeep(copy, video, world, status);
  return addedMessage(name, workingCopy.dataRemoved);
}

// A Pending copy left by an earlier locked swap is used when it carries the
// Subtitle track, passes the check against the Video (data streams may be
// missing, as after the camera-data retry), and is newer than the Video.
// Anything else in its place is stale or incomplete and is deleted.
async function usablePendingCopy(world: World, video: string, info: VideoInfo, copy: string) {
  if (!existsSync(copy)) return null;
  try {
    const [copyInfo, copyStat, videoStat] = await Promise.all([
      inspect(world.ffprobe, copy),
      stat(copy),
      stat(video),
    ]);
    if (
      hasSubtitleTrack(copyInfo) &&
      isCompleteCopy(info, copyInfo, true) &&
      copyStat.mtimeMs > videoStat.mtimeMs
    ) {
      return { dataRemoved: dataRemoved(info, copyInfo) };
    }
  } catch {}
  await log(world.stateDir, `deleting unusable Pending copy ${copy}`);
  await rm(copy, { force: true });
  return null;
}

// Replaces the Video with the checked copy. If the Video stays locked, the
// copy is kept as a Pending copy for the next Transcription.
async function swapOrKeep(copy: string, video: string, world: World, status: (state: State) => Promise<void>) {
  let swapped;
  try {
    swapped = await swapIn(copy, video, world.wait, () => status("waiting-for-unlock"));
  } catch (error) {
    await rm(copy, { force: true });
    throw error;
  }
  if (swapped === "locked") throw new Refusal("Close the video in VLC, then click Transcribe again.");
}

function addedMessage(name: string, dataRemoved: boolean) {
  const added = `Japanese subtitles added to ${name}`;
  return dataRemoved ? `${added}. Some extra camera data was removed.` : added;
}

// The working copy needs as much room as the Video itself.
async function checkFreeSpace(video: string) {
  const [disk, file] = await Promise.all([statfs(dirname(video)), stat(video)]);
  if (disk.bavail * disk.bsize < file.size) throw new Refusal("Not enough free space next to the Video.");
}

// Config: the key the extension saved, unless ELEVENLABS_API_KEY overrides it.
async function loadApiKey(world: World): Promise<string> {
  if (world.env.ELEVENLABS_API_KEY) return world.env.ELEVENLABS_API_KEY;
  let apiKey: unknown;
  try {
    apiKey = JSON.parse(await Bun.file(join(world.stateDir, "config.json")).text()).apiKey;
  } catch {}
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Refusal("No API key saved. Use Change API key.");
  return apiKey.trim();
}

function workingCopyPath(video: string) {
  const ext = extname(video);
  return join(dirname(video), `${basename(video, ext)}.kakitori.tmp${ext}`);
}

// Copies the audio track as it is. If the copy fails (e.g. PCM audio from a
// camera MOV), re-encodes it as mono AAC at 64 kbps.
async function extractAudio(ffmpeg: string, video: string, audioIndex: number, out: string) {
  const base = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-i", video, "-vn", "-map", `0:a:${audioIndex}`];
  const copied = await runProcess([...base, "-c:a", "copy", out]);
  if (copied.code === 0) return;
  const encoded = await runProcess([...base, "-ac", "1", "-c:a", "aac", "-b:a", "64k", out]);
  if (encoded.code !== 0) throw new Error(`Audio extraction failed: ${encoded.stderr.trim()}`);
}
