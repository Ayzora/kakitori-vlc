import { $ } from "bun";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Fetch } from "../src/scribe.ts";
import type { Word } from "../src/srt.ts";
import type { TranscriptionRequest, World } from "../src/transcription.ts";

const vendor = join(import.meta.dir, "..", "vendor", "ffmpeg");
const exe = process.platform === "win32" ? ".exe" : "";

export const tools = {
  ffmpeg: existsSync(join(vendor, "ffmpeg" + exe)) ? join(vendor, "ffmpeg" + exe) : "ffmpeg",
  ffprobe: existsSync(join(vendor, "ffprobe" + exe)) ? join(vendor, "ffprobe" + exe) : "ffprobe",
};

export async function tempDir() {
  return mkdtemp(join(tmpdir(), "kakitori-test-"));
}

type AudioTrack = { language?: string; channels?: 1 | 2; codec?: "aac" | "pcm_s16le" };

type VideoOptions = {
  seconds?: number;
  audio?: AudioTrack[];
  subtitleSrt?: string;
  timecode?: boolean;
  tags?: Record<string, string>;
};

export async function makeVideo(dir: string, name: string, options: VideoOptions = {}) {
  const seconds = options.seconds ?? 3;
  const audio = options.audio ?? [{ language: "jpn" }];
  const path = join(dir, name);
  const args: string[] = ["-f", "lavfi", "-i", `testsrc=size=160x120:rate=10:duration=${seconds}`];
  audio.forEach((track, i) => {
    const layout = track.channels === 2 ? "stereo" : "mono";
    args.push("-f", "lavfi", "-i", `sine=frequency=${300 + 100 * i}:duration=${seconds},aformat=channel_layouts=${layout}`);
  });
  let srtInput: number | null = null;
  if (options.subtitleSrt) {
    const srt = join(dir, `${name}.input.srt`);
    await Bun.write(srt, options.subtitleSrt);
    srtInput = audio.length + 1;
    args.push("-i", srt);
  }
  args.push("-map", "0:v");
  audio.forEach((_, i) => args.push("-map", `${i + 1}:a`));
  if (srtInput !== null) args.push("-map", `${srtInput}:s`, "-c:s", "mov_text");
  args.push("-c:v", "mpeg4");
  audio.forEach((track, i) => {
    args.push(`-c:a:${i}`, track.codec ?? "aac");
    if (track.language) args.push(`-metadata:s:a:${i}`, `language=${track.language}`);
  });
  if (options.timecode) args.push("-timecode", "00:00:00:00");
  for (const [key, value] of Object.entries(options.tags ?? {})) args.push("-metadata", `${key}=${value}`);
  if (name.toLowerCase().endsWith(".m4v")) args.push("-f", "mp4");
  args.push(path);
  await $`${tools.ffmpeg} -hide_banner -loglevel error -y ${args}`.quiet();
  if (options.subtitleSrt) await rm(join(dir, `${name}.input.srt`));
  return path;
}

export type Stream = {
  index: number;
  codec_type: string;
  codec_name?: string;
  channels?: number;
  tags?: Record<string, string>;
};
export type Probe = { streams: Stream[]; format: { duration: string; tags?: Record<string, string> } };

export async function probe(path: string): Promise<Probe> {
  return JSON.parse(
    await $`${tools.ffprobe} -v error -print_format json -show_streams -show_format ${path}`.text(),
  );
}

export async function subtitleText(path: string, subtitleIndex: number) {
  return (
    await $`${tools.ffmpeg} -hide_banner -loglevel error -i ${path} -map 0:s:${subtitleIndex} -f srt -`.text()
  ).replace(/\r\n/g, "\n");
}

export async function filesIn(dir: string) {
  return (await readdir(dir)).sort();
}

export const WORDS: Word[] = [
  { text: "今日は", start: 0.2, end: 0.8, type: "word" },
  { text: " ", start: 0.8, end: 0.8, type: "spacing" },
  { text: "いい", start: 0.8, end: 1.0, type: "word" },
  { text: "天気", start: 1.0, end: 1.3, type: "word" },
  { text: "です", start: 1.3, end: 1.5, type: "word" },
  { text: "ね。", start: 1.5, end: 1.6, type: "word" },
];

export const WORDS_SRT = "1\n00:00:00,000 --> 00:00:02,300\n今日はいい天気ですね。\n\n";

type Reply = Response | Error | (() => Response | Error);

export type ElevenLabsCall = { url: string; headers: Headers; form: FormData; audioPath: string };

export async function fakeElevenLabs(...replies: Reply[]) {
  const dir = await tempDir();
  const calls: ElevenLabsCall[] = [];
  const fetch: Fetch = async (url, init) => {
    const form = init.body as FormData;
    const file = form.get("file") as Blob;
    const audioPath = join(dir, `uploaded-${calls.length}.m4a`);
    await Bun.write(audioPath, file);
    calls.push({ url, headers: new Headers(init.headers), form, audioPath });
    let reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    if (typeof reply === "function") reply = reply();
    if (reply instanceof Error) throw reply;
    return reply.clone() as unknown as Response;
  };
  return { fetch, calls };
}

export function wordsReply(words: Word[] = WORDS) {
  return Response.json({ language_code: "jpn", text: words.map((w) => w.text).join(""), words });
}

export function timeoutError() {
  return new DOMException("The operation timed out.", "TimeoutError");
}

export type TestWorld = World & { waits: number[]; notifications: string[] };

export async function makeWorld(fetch: Fetch, apiKey = "test-key"): Promise<TestWorld> {
  const stateDir = await tempDir();
  await mkdir(stateDir, { recursive: true });
  await Bun.write(join(stateDir, "config.json"), JSON.stringify({ apiKey }));
  const waits: number[] = [];
  const notifications: string[] = [];
  return {
    stateDir,
    ffmpeg: tools.ffmpeg,
    ffprobe: tools.ffprobe,
    env: {},
    fetch,
    wait: async (ms) => {
      waits.push(ms);
    },
    notify: async (message) => {
      notifications.push(message);
    },
    waits,
    notifications,
  };
}

export function requestFor(video: string, id = "t1", replace = false): TranscriptionRequest {
  return { id, videoPath: video, videoUri: pathToFileURL(video).href, replace };
}

export async function readStatus(world: World) {
  return JSON.parse(await Bun.file(join(world.stateDir, "status.json")).text());
}

export async function misbehavingFfmpeg(mode: "refuse-data" | "drop-audio") {
  const path = join(await tempDir(), "ffmpeg");
  const real = JSON.stringify(tools.ffmpeg);
  const body =
    mode === "refuse-data"
      ? `case " $* " in *" -0:d? "*) ;; *) echo "Could not find tag for codec none" >&2; exit 1;; esac
for a in "$@"; do
  shift
  if [ "$a" = "-f" ]; then set -- "$@" -write_tmcd 0; fi
  set -- "$@" "$a"
done`
      : `prev=""
for a in "$@"; do
  shift
  if [ "$prev" = "-map" ] && [ "$a" = "0" ]; then set -- "$@" "0:v"; else set -- "$@" "$a"; fi
  prev="$a"
done`;
  await Bun.write(
    path,
    `#!/bin/sh
case "$*" in *kakitori.tmp*) ;; *) exec ${real} "$@";; esac
${body}
exec ${real} "$@"
`,
  );
  await chmod(path, 0o755);
  return path;
}

export async function stateRecordingFfmpeg(statusPath: string, logPath: string) {
  const path = join(await tempDir(), "ffmpeg");
  await Bun.write(
    path,
    `#!/bin/sh
printf '%s\\n' "$(sed -n 's/.*"state":"\\([^"]*\\)".*/\\1/p' ${JSON.stringify(statusPath)})" >> ${JSON.stringify(logPath)}
exec ${JSON.stringify(tools.ffmpeg)} "$@"
`,
  );
  await chmod(path, 0o755);
  return path;
}
