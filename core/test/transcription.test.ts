import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { chmod, copyFile, rename, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { runTranscription } from "../src/transcription.ts";
import {
  WORDS_SRT,
  fakeElevenLabs,
  filesIn,
  makeVideo,
  makeWorld,
  misbehavingFfmpeg,
  probe,
  stateRecordingFfmpeg,
  readStatus,
  subtitleText,
  tempDir,
  timeoutError,
  wordsReply,
} from "./helpers.ts";

describe("a successful Transcription", () => {
  test("adds a Japanese Subtitle track inside an MP4 with a Japanese name", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "日本語の動画.mp4");
    const elevenLabs = await fakeElevenLabs(wordsReply());
    const world = await makeWorld(elevenLabs.fetch);

    const outcome = await runTranscription({ id: "t1", videoPath: video }, world);

    expect(outcome.kind).toBe("done");
    const after = await probe(video);
    const subtitles = after.streams.filter((s) => s.codec_type === "subtitle");
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0]!.codec_name).toBe("mov_text");
    expect(subtitles[0]!.tags?.language).toBe("jpn");
    expect(subtitles[0]!.tags?.handler_name).toBe("Japanese");
    expect(await subtitleText(video, 0)).toBe(WORDS_SRT);
    expect(world.popups).toEqual(["Japanese subtitles added to 日本語の動画.mp4"]);
    expect(await readStatus(world)).toMatchObject({
      id: "t1",
      state: "done",
      inputPath: video,
      message: "Japanese subtitles added to 日本語の動画.mp4",
    });
    expect(await filesIn(dir)).toEqual(["日本語の動画.mp4"]);
  });

  test("sends only the audio to Scribe v2 with fixed Japanese settings", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const elevenLabs = await fakeElevenLabs(wordsReply());
    const world = await makeWorld(elevenLabs.fetch, "sk-saved");

    await runTranscription({ id: "t1", videoPath: video }, world);

    expect(elevenLabs.calls).toHaveLength(1);
    const call = elevenLabs.calls[0]!;
    expect(call.url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(call.headers.get("xi-api-key")).toBe("sk-saved");
    expect({
      model_id: call.form.get("model_id"),
      language_code: call.form.get("language_code"),
      timestamps_granularity: call.form.get("timestamps_granularity"),
      diarize: call.form.get("diarize"),
      tag_audio_events: call.form.get("tag_audio_events"),
    }).toEqual({
      model_id: "scribe_v2",
      language_code: "jpn",
      timestamps_granularity: "word",
      diarize: "false",
      tag_audio_events: "false",
    });
    const uploaded = await probe(call.audioPath);
    expect(uploaded.streams.map((s) => s.codec_type)).toEqual(["audio"]);
  });

  test("uses the ELEVENLABS_API_KEY environment variable over the saved key", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const elevenLabs = await fakeElevenLabs(wordsReply());
    const world = await makeWorld(elevenLabs.fetch, "sk-saved");
    world.env.ELEVENLABS_API_KEY = "sk-from-env";

    await runTranscription({ id: "t1", videoPath: video }, world);

    expect(elevenLabs.calls[0]!.headers.get("xi-api-key")).toBe("sk-from-env");
  });

  for (const name of ["clip.mov", "clip.m4v", "CLIP.MP4"]) {
    test(`keeps the container of ${name}`, async () => {
      const dir = await tempDir();
      const video = await makeVideo(dir, name);
      const before = await probe(video);
      const world = await makeWorld((await fakeElevenLabs(wordsReply())).fetch);

      const outcome = await runTranscription({ id: "t1", videoPath: video }, world);

      expect(outcome).toEqual({ kind: "done", message: `Japanese subtitles added to ${name}` });
      const after = await probe(video);
      expect(after.format.tags?.major_brand).toBe(before.format.tags?.major_brand!);
      expect(await subtitleText(video, 0)).toBe(WORDS_SRT);
      expect(await filesIn(dir)).toEqual([name]);
    });
  }
});

describe("what the Video keeps", () => {
  test("every existing stream, its other subtitles and its title and date stay as they were", async () => {
    const dir = await tempDir();
    const existing = "1\n00:00:00,500 --> 00:00:01,500\nHello\n\n";
    const video = await makeVideo(dir, "anime.mp4", {
      audio: [
        { language: "eng", channels: 2 },
        { language: "jpn", channels: 1 },
      ],
      subtitleSrt: existing,
      tags: { title: "第1話", creation_time: "2024-04-01T09:30:00.000000Z" },
    });
    const before = await probe(video);
    const elevenLabs = await fakeElevenLabs(wordsReply());
    const world = await makeWorld(elevenLabs.fetch);

    await runTranscription({ id: "t1", videoPath: video }, world);

    const after = await probe(video);
    const signature = (p: typeof before) => p.streams.map((s) => `${s.codec_type}:${s.codec_name}`);
    expect(signature(after)).toEqual([...signature(before), "subtitle:mov_text"]);
    expect(after.format.tags?.title).toBe("第1話");
    expect(after.format.tags?.creation_time).toBe("2024-04-01T09:30:00.000000Z");
    expect(await subtitleText(video, 0)).toBe(existing);
    expect(await subtitleText(video, 1)).toBe(WORDS_SRT);
  });

  test("the first Japanese audio track is the one transcribed, not an earlier English dub", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "anime.mp4", {
      audio: [
        { language: "eng", channels: 2 },
        { language: "jpn", channels: 1 },
      ],
    });
    const elevenLabs = await fakeElevenLabs(wordsReply());

    await runTranscription({ id: "t1", videoPath: video }, await makeWorld(elevenLabs.fetch));

    const uploaded = await probe(elevenLabs.calls[0]!.audioPath);
    expect(uploaded.streams[0]!.channels).toBe(1);
  });

  test("with no Japanese-tagged audio, the first audio track is transcribed", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "home.mp4", {
      audio: [{ channels: 2 }, { channels: 1 }],
    });
    const elevenLabs = await fakeElevenLabs(wordsReply());

    await runTranscription({ id: "t1", videoPath: video }, await makeWorld(elevenLabs.fetch));

    const uploaded = await probe(elevenLabs.calls[0]!.audioPath);
    expect(uploaded.streams[0]!.channels).toBe(2);
  });

  test("uncompressed MOV audio is re-encoded as compact mono AAC before upload", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "camera.mov", {
      audio: [{ codec: "pcm_s16le", channels: 2 }],
    });
    const elevenLabs = await fakeElevenLabs(wordsReply());

    const outcome = await runTranscription({ id: "t1", videoPath: video }, await makeWorld(elevenLabs.fetch));

    expect(outcome.kind).toBe("done");
    const uploaded = await probe(elevenLabs.calls[0]!.audioPath);
    expect(uploaded.streams[0]).toMatchObject({ codec_name: "aac", channels: 1 });
  });

  test.skipIf(process.platform !== "darwin")("the title stays visible to Apple's players", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "trip.mov", { tags: { title: "京都旅行" } });
    const world = await makeWorld((await fakeElevenLabs(wordsReply())).fetch);

    await runTranscription({ id: "t1", videoPath: video }, world);

    const apple = await $`avmetareadwrite -o ${video}`.text();
    expect(apple).toContain("common/title: 京都旅行");
  });
});

describe("the swap", () => {
  test("keeps the Video's modified date", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const modified = new Date("2021-06-01T12:00:00Z");
    await utimes(video, modified, modified);

    await runTranscription({ id: "t1", videoPath: video }, await makeWorld((await fakeElevenLabs(wordsReply())).fetch));

    expect((await stat(video)).mtime.toISOString()).toBe(modified.toISOString());
  });

  test.skipIf(process.platform === "win32")("keeps the Video's permissions", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    await chmod(video, 0o640);

    await runTranscription({ id: "t1", videoPath: video }, await makeWorld((await fakeElevenLabs(wordsReply())).fetch));

    expect((await stat(video)).mode & 0o777).toBe(0o640);
  });
});

describe.skipIf(process.platform === "win32")("camera data and the safety check", () => {
  test("data tracks ffmpeg can't copy are dropped, and the popup says so", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "IMG_0001.MOV", { timecode: true });
    const before = await probe(video);
    const world = await makeWorld((await fakeElevenLabs(wordsReply())).fetch);
    world.ffmpeg = await misbehavingFfmpeg("refuse-data");

    const outcome = await runTranscription({ id: "t1", videoPath: video }, world);

    const message = "Japanese subtitles added to IMG_0001.MOV. Some extra camera data was removed.";
    expect(outcome).toEqual({ kind: "done", message });
    expect(world.popups).toEqual([message]);
    const kinds = (p: typeof before) => p.streams.map((s) => s.codec_type);
    expect(kinds(before)).toEqual(["video", "audio", "data"]);
    expect(kinds(await probe(video))).toEqual(["video", "audio", "subtitle"]);
  });

  test("a working copy that lost a stream is never swapped in", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const bytes = await Bun.file(video).bytes();
    const world = await makeWorld((await fakeElevenLabs(wordsReply())).fetch);
    world.ffmpeg = await misbehavingFfmpeg("drop-audio");

    const outcome = await runTranscription({ id: "t1", videoPath: video }, world);

    expect(outcome).toEqual({ kind: "error", message: "Couldn't add the subtitles to this file." });
    expect(await Bun.file(video).bytes()).toEqual(bytes);
    expect(await filesIn(dir)).toEqual(["lesson.mp4"]);
  });
});

describe("a Pending copy", () => {
  // A Pending copy as a locked swap leaves it: the finished copy of `video`
  // sitting next to it.
  async function pendingCopyOf(video: string, modified: Date) {
    const finished = video.replace(/\.mp4$/, ".finished.mp4");
    await copyFile(video, finished);
    await runTranscription(
      { id: "earlier", videoPath: finished },
      await makeWorld((await fakeElevenLabs(wordsReply())).fetch),
    );
    const pending = video.replace(/\.mp4$/, ".kakitori.tmp.mp4");
    await rename(finished, pending);
    await utimes(pending, modified, modified);
    return pending;
  }

  test("is swapped in without contacting ElevenLabs again", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const videoModified = new Date("2021-01-01T00:00:00Z");
    await pendingCopyOf(video, new Date("2022-01-01T00:00:00Z"));
    await utimes(video, videoModified, videoModified);
    const elevenLabs = await fakeElevenLabs(new TypeError("must not be called"));
    const world = await makeWorld(elevenLabs.fetch);

    const outcome = await runTranscription({ id: "t1", videoPath: video }, world);

    expect(outcome).toEqual({ kind: "done", message: "Japanese subtitles added to lesson.mp4" });
    expect(elevenLabs.calls).toHaveLength(0);
    expect(await subtitleText(video, 0)).toBe(WORDS_SRT);
    expect(await filesIn(dir)).toEqual(["lesson.mp4"]);
    expect((await stat(video)).mtime.toISOString()).toBe(videoModified.toISOString());
  });

  test("older than its Video (the Video changed since) is thrown away and the Video transcribed afresh", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    await pendingCopyOf(video, new Date("2020-01-01T00:00:00Z"));
    const elevenLabs = await fakeElevenLabs(wordsReply());

    const outcome = await runTranscription({ id: "t1", videoPath: video }, await makeWorld(elevenLabs.fetch));

    expect(outcome.kind).toBe("done");
    expect(elevenLabs.calls).toHaveLength(1);
    expect(await filesIn(dir)).toEqual(["lesson.mp4"]);
  });

  test("that is incomplete is thrown away and the Video transcribed afresh", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    await Bun.write(join(dir, "lesson.kakitori.tmp.mp4"), "half a file");
    const elevenLabs = await fakeElevenLabs(wordsReply());

    const outcome = await runTranscription({ id: "t1", videoPath: video }, await makeWorld(elevenLabs.fetch));

    expect(outcome.kind).toBe("done");
    expect(elevenLabs.calls).toHaveLength(1);
    expect(await subtitleText(video, 0)).toBe(WORDS_SRT);
    expect(await filesIn(dir)).toEqual(["lesson.mp4"]);
  });
});

describe.skipIf(process.platform !== "win32")("a Video locked by another program (Windows)", () => {
  // Opens the Video the way VLC does on Windows: other programs may read it
  // but not delete or replace it.
  async function holdOpen(video: string) {
    const path = video.replace(/'/g, "''");
    const holder = Bun.spawn([
      "powershell", "-NoProfile", "-Command",
      `$f = [System.IO.File]::Open('${path}', 'Open', 'Read', 'Read'); Start-Sleep -Seconds 600`,
    ]);
    await Bun.sleep(3000);
    return holder;
  }

  test("is retried for 2 minutes, then the copy is kept as a Pending copy and used next time", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const holder = await holdOpen(video);
    const elevenLabs = await fakeElevenLabs(wordsReply());
    const world = await makeWorld(elevenLabs.fetch);
    const states: string[] = [];
    world.wait = async (ms) => {
      world.waits.push(ms);
      states.push((await readStatus(world)).state);
    };

    const first = await runTranscription({ id: "t1", videoPath: video }, world);
    holder.kill();
    await holder.exited;

    expect(first).toEqual({ kind: "error", message: "Close the video in VLC, then click Transcribe again." });
    expect(world.waits).toEqual(Array(24).fill(5000));
    expect(new Set(states)).toEqual(new Set(["waiting-for-unlock"]));
    expect(await filesIn(dir)).toEqual(["lesson.kakitori.tmp.mp4", "lesson.mp4"]);

    const second = await runTranscription({ id: "t2", videoPath: video }, world);

    expect(second).toEqual({ kind: "done", message: "Japanese subtitles added to lesson.mp4" });
    expect(elevenLabs.calls).toHaveLength(1);
    expect(await filesIn(dir)).toEqual(["lesson.mp4"]);
  }, 60_000);
});

describe("a Video that already has a Subtitle track", () => {
  test("is never transcribed again", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const elevenLabs = await fakeElevenLabs(wordsReply());
    await runTranscription({ id: "t1", videoPath: video }, await makeWorld(elevenLabs.fetch));
    const bytes = await Bun.file(video).bytes();
    const world = await makeWorld(elevenLabs.fetch);

    const outcome = await runTranscription({ id: "t2", videoPath: video }, world);

    const message = "Japanese subtitles are already in lesson.mp4";
    expect(outcome).toEqual({ kind: "already-subtitled", message });
    expect(elevenLabs.calls).toHaveLength(1);
    expect(world.popups).toEqual([message]);
    expect(await readStatus(world)).toMatchObject({ id: "t2", state: "done", message });
    expect(await Bun.file(video).bytes()).toEqual(bytes);
  });
});

describe("Videos that are turned away", () => {
  const cases = [
    {
      what: "a file type other than MP4, M4V or MOV",
      make: (dir: string) => makeVideo(dir, "show.mkv"),
      message: "Subtitles can't be added to this file type.",
    },
    {
      what: "a Video without audio",
      make: (dir: string) => makeVideo(dir, "silent.mp4", { audio: [] }),
      message: "No audio track found.",
    },
    {
      what: "a Video that doesn't exist",
      make: async (dir: string) => join(dir, "gone.mp4"),
      message: "The video file can't be found.",
    },
  ];

  for (const { what, make, message } of cases) {
    test(`${what}: "${message}", with nothing uploaded or changed`, async () => {
      const dir = await tempDir();
      const video = await make(dir);
      const before = await filesIn(dir);
      const elevenLabs = await fakeElevenLabs(wordsReply());
      const world = await makeWorld(elevenLabs.fetch);

      const outcome = await runTranscription({ id: "t1", videoPath: video }, world);

      expect(outcome).toEqual({ kind: "error", message });
      expect(elevenLabs.calls).toHaveLength(0);
      expect(world.popups).toEqual([message]);
      expect(await readStatus(world)).toMatchObject({ id: "t1", state: "error", inputPath: video, message });
      expect(await filesIn(dir)).toEqual(before);
    });
  }
});

describe("when ElevenLabs fails", () => {
  const error = (status: number, message: string) =>
    Response.json({ detail: { status: "error", message } }, { status });
  const cases = [
    {
      what: "a rejected key",
      replies: [error(401, "Invalid API key")],
      message: "API key rejected. Use Change API key.",
      calls: 1,
    },
    {
      what: "no credits left",
      replies: [error(402, "You have run out of credits.")],
      message: "You have run out of credits.",
      calls: 1,
    },
    {
      what: "a rate limit",
      replies: [error(429, "Too many concurrent requests.")],
      message: "Too many concurrent requests.",
      calls: 1,
    },
    {
      what: "a server error that doesn't go away",
      replies: [new Response("Internal error", { status: 500 })],
      message: "ElevenLabs had a problem. Try again later.",
      calls: 4,
    },
    {
      what: "no connection",
      replies: [new TypeError("fetch failed")],
      message: "Couldn't reach ElevenLabs. Check your internet connection.",
      calls: 4,
    },
    {
      what: "no answer within 15 minutes",
      replies: [timeoutError()],
      message: "ElevenLabs took too long. Try again later.",
      calls: 1,
    },
  ];

  for (const { what, replies, message, calls } of cases) {
    test(`${what}: "${message}" after ${calls} call(s), with the Video untouched`, async () => {
      const dir = await tempDir();
      const video = await makeVideo(dir, "lesson.mp4");
      const bytes = await Bun.file(video).bytes();
      const elevenLabs = await fakeElevenLabs(...replies);
      const world = await makeWorld(elevenLabs.fetch);

      const outcome = await runTranscription({ id: "t1", videoPath: video }, world);

      expect(outcome).toEqual({ kind: "error", message });
      expect(elevenLabs.calls).toHaveLength(calls);
      expect(world.popups).toEqual([message]);
      expect(await readStatus(world)).toMatchObject({ state: "error", message });
      expect(await Bun.file(video).bytes()).toEqual(bytes);
      expect(await filesIn(dir)).toEqual(["lesson.mp4"]);
    });
  }

  test("connection failures and server errors are retried after 2, 4 and 8 seconds", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const elevenLabs = await fakeElevenLabs(new TypeError("fetch failed"), new Response("", { status: 503 }), wordsReply());
    const world = await makeWorld(elevenLabs.fetch);

    const outcome = await runTranscription({ id: "t1", videoPath: video }, world);

    expect(outcome.kind).toBe("done");
    expect(elevenLabs.calls).toHaveLength(3);
    expect(world.waits).toEqual([2000, 4000]);
  });

  test("a failure that isn't retried waits for nothing", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const world = await makeWorld((await fakeElevenLabs(timeoutError())).fetch);

    await runTranscription({ id: "t1", videoPath: video }, world);

    expect(world.waits).toEqual([]);
  });
});

describe("one Transcription at a time", () => {
  test("a second Transcription while one is running is turned away and leaves the status alone", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const elevenLabs = await fakeElevenLabs(wordsReply());
    const world = await makeWorld(elevenLabs.fetch);
    const running = { id: "t1", state: "transcribing", inputPath: "/videos/other.mp4", message: "", updatedAt: "x" };
    await Bun.write(join(world.stateDir, "status.json"), JSON.stringify(running));
    await Bun.write(join(world.stateDir, "kakitori.lock"), String(process.pid));

    const outcome = await runTranscription({ id: "t2", videoPath: video }, world);

    expect(outcome).toEqual({ kind: "error", message: "A transcription is already running." });
    expect(world.popups).toEqual(["A transcription is already running."]);
    expect(elevenLabs.calls).toHaveLength(0);
    expect(await readStatus(world)).toEqual(running);
    expect(existsSync(join(world.stateDir, "kakitori.lock"))).toBe(true);
  });

  test("a lock left by a process that has ended doesn't block", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const world = await makeWorld((await fakeElevenLabs(wordsReply())).fetch);
    const ended = Bun.spawn([process.execPath, "--version"], { stdout: "ignore" });
    await ended.exited;
    await Bun.write(join(world.stateDir, "kakitori.lock"), String(ended.pid));

    const outcome = await runTranscription({ id: "t1", videoPath: video }, world);

    expect(outcome.kind).toBe("done");
    expect(existsSync(join(world.stateDir, "kakitori.lock"))).toBe(false);
  });

  test.skipIf(process.platform === "win32")("status.json moves through each stage in order", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const states = join(await tempDir(), "states.log");
    const elevenLabs = await fakeElevenLabs(() => {
      appendFileSync(states, `${statusNow().state}\n`);
      return wordsReply();
    });
    const world = await makeWorld(elevenLabs.fetch);
    const statusNow = () => JSON.parse(readFileSync(join(world.stateDir, "status.json"), "utf8"));
    world.ffmpeg = await stateRecordingFfmpeg(join(world.stateDir, "status.json"), states);
    world.popup = async () => appendFileSync(states, `${statusNow().state}\n`);

    await runTranscription({ id: "t1", videoPath: video }, world);

    const seen = (await Bun.file(states).text()).trim().split("\n");
    expect(seen.filter((state, i) => state !== seen[i - 1])).toEqual(["extracting", "transcribing", "muxing", "done"]);
  });

  test("the final status is written and the lock released before the popup shows", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const seen: { state: string; locked: boolean }[] = [];
    const elevenLabs = await fakeElevenLabs(() => {
      seen.push({ state: statusNow().state, locked: lockedNow() });
      return wordsReply();
    });
    const world = await makeWorld(elevenLabs.fetch);
    const statusNow = () => JSON.parse(readFileSync(join(world.stateDir, "status.json"), "utf8"));
    const lockedNow = () => existsSync(join(world.stateDir, "kakitori.lock"));
    world.popup = async () => {
      seen.push({ state: statusNow().state, locked: lockedNow() });
    };

    await runTranscription({ id: "t1", videoPath: video }, world);

    expect(seen).toEqual([
      { state: "transcribing", locked: true },
      { state: "done", locked: false },
    ]);
  });
});

describe("the log", () => {
  test("records each Transcription but never the API key", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const key = "sk_live_very_secret_123";
    const rejected = Response.json({ detail: { message: "Invalid API key" } }, { status: 401 });
    const world = await makeWorld((await fakeElevenLabs(rejected, wordsReply())).fetch, key);

    await runTranscription({ id: "t1", videoPath: video }, world);
    await runTranscription({ id: "t2", videoPath: video }, world);

    const log = await Bun.file(join(world.stateDir, "log.txt")).text();
    expect(log).toContain("[t1]");
    expect(log).toContain("[t2]");
    expect(log).not.toContain(key);
  });

  test("a popup that fails to show is logged and the result is still in the status", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const world = await makeWorld((await fakeElevenLabs(wordsReply())).fetch);
    world.popup = async () => {
      throw new Error("osascript exited with 1");
    };

    const outcome = await runTranscription({ id: "t1", videoPath: video }, world);

    expect(outcome.kind).toBe("done");
    expect(await readStatus(world)).toMatchObject({ state: "done", message: "Japanese subtitles added to lesson.mp4" });
    expect(await Bun.file(join(world.stateDir, "log.txt")).text()).toContain("osascript exited with 1");
  });
});

describe("the API key", () => {
  test("with no key saved, the Transcription stops before anything is uploaded", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const elevenLabs = await fakeElevenLabs(wordsReply());
    const world = await makeWorld(elevenLabs.fetch);
    await rm(join(world.stateDir, "config.json"));

    const outcome = await runTranscription({ id: "t1", videoPath: video }, world);

    expect(outcome).toEqual({ kind: "error", message: "No API key saved. Use Change API key." });
    expect(elevenLabs.calls).toHaveLength(0);
  });
});

describe("choosing the Video in the file picker", () => {
  test("asks to confirm the name and length, then transcribes", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "授業.mp4", { seconds: 3 });
    const elevenLabs = await fakeElevenLabs(wordsReply());
    const world = await makeWorld(elevenLabs.fetch);
    world.chooseVideo = async () => video;

    const outcome = await runTranscription({ id: "t1", videoPath: null }, world);

    expect(world.confirmations).toEqual(["Transcribe 授業.mp4 (0:03)?"]);
    expect(outcome).toEqual({ kind: "done", message: "Japanese subtitles added to 授業.mp4" });
    expect(await readStatus(world)).toMatchObject({ state: "done", inputPath: video });
    expect(await subtitleText(video, 0)).toBe(WORDS_SRT);
  });

  test("cancelling the picker changes nothing and shows no popup", async () => {
    const elevenLabs = await fakeElevenLabs(wordsReply());
    const world = await makeWorld(elevenLabs.fetch);
    world.chooseVideo = async () => null;

    const outcome = await runTranscription({ id: "t1", videoPath: null }, world);

    expect(outcome.kind).toBe("cancelled");
    expect(world.popups).toEqual([]);
    expect(existsSync(join(world.stateDir, "status.json"))).toBe(false);
    expect(existsSync(join(world.stateDir, "kakitori.lock"))).toBe(false);
    expect(elevenLabs.calls).toHaveLength(0);
  });

  test("answering Cancel to the confirmation uploads nothing and leaves the Video alone", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const bytes = await Bun.file(video).bytes();
    const elevenLabs = await fakeElevenLabs(wordsReply());
    const world = await makeWorld(elevenLabs.fetch);
    world.chooseVideo = async () => video;
    world.answer = false;

    const outcome = await runTranscription({ id: "t1", videoPath: null }, world);

    expect(outcome.kind).toBe("cancelled");
    expect(elevenLabs.calls).toHaveLength(0);
    expect(world.popups).toEqual([]);
    expect(existsSync(join(world.stateDir, "status.json"))).toBe(false);
    expect(await Bun.file(video).bytes()).toEqual(bytes);
  });

  test("a Video that already has a Subtitle track isn't offered for transcription", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const elevenLabs = await fakeElevenLabs(wordsReply());
    await runTranscription({ id: "t0", videoPath: video }, await makeWorld(elevenLabs.fetch));
    const world = await makeWorld(elevenLabs.fetch);
    world.chooseVideo = async () => video;

    const outcome = await runTranscription({ id: "t1", videoPath: null }, world);

    expect(world.confirmations).toEqual([]);
    expect(outcome).toEqual({ kind: "already-subtitled", message: "Japanese subtitles are already in lesson.mp4" });
  });

  test("while a Transcription is running, the picker doesn't open", async () => {
    const world = await makeWorld((await fakeElevenLabs(wordsReply())).fetch);
    await Bun.write(join(world.stateDir, "kakitori.lock"), String(process.pid));
    let opened = false;
    world.chooseVideo = async () => {
      opened = true;
      return null;
    };

    const outcome = await runTranscription({ id: "t1", videoPath: null }, world);

    expect(opened).toBe(false);
    expect(outcome.message).toBe("A transcription is already running.");
  });

  test("a Video given directly (from a terminal) is not asked about", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const world = await makeWorld((await fakeElevenLabs(wordsReply())).fetch);

    await runTranscription({ id: "t1", videoPath: video }, world);

    expect(world.confirmations).toEqual([]);
  });
});

