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

function stateDir() {
  if (compiled) return dirname(binDir);
  const vlcUserData =
    process.platform === "win32"
      ? join(process.env.APPDATA ?? homedir(), "vlc")
      : process.platform === "linux"
        ? join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "vlc")
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
  notify: cliVideo ? async () => {} : notify,
};

const outcome = await runTranscription(request, world);
if (cliVideo) console.log(outcome.message);
process.exit(outcome.kind === "error" ? 1 : 0);
