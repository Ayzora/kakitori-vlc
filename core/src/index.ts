// kakitori, the core program.
//
//   kakitori          runs the Transcription the extension wrote to job.json
//   kakitori <video>  transcribes one Video from a terminal
//
// Installed layout: <state folder>/bin/kakitori next to ffmpeg and ffprobe,
// where the state folder is VLC's user data folder plus "kakitori".

import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { showPopup } from "./popup.ts";
import { log } from "./state.ts";
import { runTranscription, type TranscriptionRequest, type World } from "./transcription.ts";

const exe = process.platform === "win32" ? ".exe" : "";
const compiled = !/^bun(\.exe)?$/i.test(basename(process.execPath));
const binDir = dirname(process.execPath);

// Running from source (bun src/index.ts) uses the state folder VLC would use.
function stateDir() {
  if (compiled) return dirname(binDir);
  const vlcUserData =
    process.platform === "win32"
      ? join(process.env.APPDATA ?? homedir(), "vlc")
      : join(homedir(), "Library", "Application Support", "org.videolan.vlc");
  return join(vlcUserData, "kakitori");
}

function tool(name: string) {
  if (compiled) return join(binDir, name + exe);
  const vendored = join(import.meta.dir, "..", "vendor", "ffmpeg", name + exe);
  return existsSync(vendored) ? vendored : name;
}

// The extension's request. It is deleted as soon as it is read, so a second
// launch with nothing waiting exits silently.
async function takeJob(dir: string): Promise<TranscriptionRequest | null> {
  const path = join(dir, "job.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  await rm(path, { force: true });
  try {
    const job = JSON.parse(text.replace(/^﻿/, ""));
    if (typeof job.inputPath !== "string" || !job.inputPath) throw new Error("no inputPath");
    return { id: String(job.id ?? crypto.randomUUID()), videoPath: job.inputPath };
  } catch (error) {
    await log(dir, `ignoring unreadable job.json: ${error}`);
    return null;
  }
}

const dir = stateDir();
await mkdir(dir, { recursive: true });

const cliVideo = process.argv[2];
const request = cliVideo
  ? { id: crypto.randomUUID(), videoPath: resolve(cliVideo) }
  : await takeJob(dir);
if (!request) process.exit(0);

const world: World = {
  stateDir: dir,
  ffmpeg: tool("ffmpeg"),
  ffprobe: tool("ffprobe"),
  env: process.env,
  fetch: (url, init) => fetch(url, init),
  popup: cliVideo ? async () => {} : showPopup,
  wait: (ms) => Bun.sleep(ms),
};

const outcome = await runTranscription(request, world);
if (cliVideo) console.log(outcome.message);
process.exit(outcome.kind === "done" ? 0 : 1);
