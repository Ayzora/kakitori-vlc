// kakitori, the core program.
//
//   kakitori          runs the Transcription the extension asked for in
//                     job.json: the Video VLC is playing
//   kakitori <video>  transcribes one Video from a terminal
//
// Installed layout: <state folder>/bin/kakitori next to ffmpeg and ffprobe,
// where the state folder is VLC's user data folder plus "kakitori".

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { notify } from "./notify.ts";
import { takeRequest } from "./request.ts";
import { runTranscription, type World } from "./transcription.ts";

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

const dir = stateDir();
await mkdir(dir, { recursive: true });

const cliVideo = process.argv[2];
const request = cliVideo
  ? {
      id: crypto.randomUUID(),
      videoPath: resolve(cliVideo),
      videoUri: pathToFileURL(resolve(cliVideo)).href,
      replace: false,
    }
  : await takeRequest(dir);
if (!request) process.exit(0);

const world: World = {
  stateDir: dir,
  ffmpeg: tool("ffmpeg"),
  ffprobe: tool("ffprobe"),
  env: process.env,
  fetch: (url, init) => fetch(url, init),
  wait: (ms) => Bun.sleep(ms),
  // A terminal run prints the message instead.
  notify: cliVideo ? async () => {} : notify,
};

const outcome = await runTranscription(request, world);
if (cliVideo) console.log(outcome.message);
process.exit(outcome.kind === "error" ? 1 : 0);
