import { $ } from "bun";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync, renameSync } from "node:fs";
import { chmod, copyFile, rename, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
  requestFor,
  subtitleText,
  tempDir,
  timeoutError,
  wordsReply,
} from "./helpers.ts";

// Each test makes and remuxes real Videos; Windows CI machines are slow.
setDefaultTimeout(30_000);

describe("a successful Transcription", () => {
  test("adds a Japanese Subtitle track inside an MP4 with a Japanese name", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "日本語の動画.mp4");
    const elevenLabs = await fakeElevenLabs(wordsReply());
    const world = await makeWorld(elevenLabs.fetch);

    const outcome = await runTranscription(requestFor(video), world);

    expect(outcome.kind).toBe("done");
    const after = await probe(video);
    const subtitles = after.streams.filter((s) => s.codec_type === "subtitle");
    expect(subtitles).toHaveLength(1);
    expect(subtitles[0]!.codec_name).toBe("mov_text");
    expect(subtitles[0]!.tags?.language).toBe("jpn");
    expect(subtitles[0]!.tags?.handler_name).toBe("Japanese");
    expect(await subtitleText(video, 0)).toBe(WORDS_SRT);
    expect(world.notifications).toEqual([
      "Japanese subtitles added to 日本語の動画.mp4. Open Kakitori and click Reload video.",
    ]);
    expect(await readStatus(world)).toMatchObject({
      id: "t1",
      state: "done",
      inputPath: video,
      videoUri: pathToFileURL(video).href,
      message: "Japanese subtitles added to 日本語の動画.mp4",
    });
    expect(await filesIn(dir)).toEqual(["日本語の動画.mp4"]);
  });

  test("sends only the audio to Scribe v2 with fixed Japanese settings", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const elevenLabs = await fakeElevenLabs(wordsReply());
    const world = await makeWorld(elevenLabs.fetch, "sk-saved");

    await runTranscription(requestFor(video), world);

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

    await runTranscription(requestFor(video), world);

    expect(elevenLabs.calls[0]!.headers.get("xi-api-key")).toBe("sk-from-env");
  });

  for (const name of ["clip.mov", "clip.m4v", "CLIP.MP4"]) {
    test(`keeps the container of ${name}`, async () => {
      const dir = await tempDir();
      const video = await makeVideo(dir, name);
      const before = await probe(video);
      const world = await makeWorld((await fakeElevenLabs(wordsReply())).fetch);

      const outcome = await runTranscription(requestFor(video), world);

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

    await runTranscription(requestFor(video), world);

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

    await runTranscription(requestFor(video), await makeWorld(elevenLabs.fetch));

    const uploaded = await probe(elevenLabs.calls[0]!.audioPath);
    expect(uploaded.streams[0]!.channels).toBe(1);
  });

  test("with no Japanese-tagged audio, the first audio track is transcribed", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "home.mp4", {
      audio: [{ channels: 2 }, { channels: 1 }],
    });
    const elevenLabs = await fakeElevenLabs(wordsReply());

    await runTranscription(requestFor(video), await makeWorld(elevenLabs.fetch));

    const uploaded = await probe(elevenLabs.calls[0]!.audioPath);
    expect(uploaded.streams[0]!.channels).toBe(2);
  });

  test("uncompressed MOV audio is re-encoded as compact mono AAC before upload", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "camera.mov", {
      audio: [{ codec: "pcm_s16le", channels: 2 }],
    });
    const elevenLabs = await fakeElevenLabs(wordsReply());

    const outcome = await runTranscription(requestFor(video), await makeWorld(elevenLabs.fetch));

    expect(outcome.kind).toBe("done");
    const uploaded = await probe(elevenLabs.calls[0]!.audioPath);
    expect(uploaded.streams[0]).toMatchObject({ codec_name: "aac", channels: 1 });
  });

  test.skipIf(process.platform !== "darwin")("the title stays visible to Apple's players", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "trip.mov", { tags: { title: "京都旅行" } });
    const world = await makeWorld((await fakeElevenLabs(wordsReply())).fetch);

    await runTranscription(requestFor(video), world);

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

    await runTranscription(requestFor(video), await makeWorld((await fakeElevenLabs(wordsReply())).fetch));

    expect((await stat(video)).mtime.toISOString()).toBe(modified.toISOString());
  });

  test.skipIf(process.platform === "win32")("keeps the Video's permissions", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    await chmod(video, 0o640);

    await runTranscription(requestFor(video), await makeWorld((await fakeElevenLabs(wordsReply())).fetch));

    expect((await stat(video)).mode & 0o777).toBe(0o640);
  });
});

describe.skipIf(process.platform === "win32")("camera data and the safety check", () => {
  test("data tracks ffmpeg can't copy are dropped, and the status says so", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "IMG_0001.MOV", { timecode: true });
    const before = await probe(video);
    const world = await makeWorld((await fakeElevenLabs(wordsReply())).fetch);
    world.ffmpeg = await misbehavingFfmpeg("refuse-data");

    const outcome = await runTranscription(requestFor(video), world);

    const message = "Japanese subtitles added to IMG_0001.MOV. Some extra camera data was removed.";
    expect(outcome).toEqual({ kind: "done", message });
    expect(await readStatus(world)).toMatchObject({ state: "done", message });
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

    const outcome = await runTranscription(requestFor(video), world);

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
      requestFor(finished, "earlier"),
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

    const outcome = await runTranscription(requestFor(video), world);

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

    const outcome = await runTranscription(requestFor(video), await makeWorld(elevenLabs.fetch));

    expect(outcome.kind).toBe("done");
    expect(elevenLabs.calls).toHaveLength(1);
    expect(await filesIn(dir)).toEqual(["lesson.mp4"]);
  });

  test("that is incomplete is thrown away and the Video transcribed afresh", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    await Bun.write(join(dir, "lesson.kakitori.tmp.mp4"), "half a file");
    const elevenLabs = await fakeElevenLabs(wordsReply());

    const outcome = await runTranscription(requestFor(video), await makeWorld(elevenLabs.fetch));

    expect(outcome.kind).toBe("done");
    expect(elevenLabs.calls).toHaveLength(1);
    expect(await subtitleText(video, 0)).toBe(WORDS_SRT);
    expect(await filesIn(dir)).toEqual(["lesson.mp4"]);
  });
});

describe.skipIf(process.platform !== "win32")("a Video locked by another program (Windows)", () => {
  // Opens the Video the way VLC does on Windows: other programs may read it
  // but not delete or replace it. Returns once PowerShell reports it has the
  // file open, however long PowerShell takes to start.
  async function holdOpen(video: string) {
    const path = video.replace(/'/g, "''");
    const holder = Bun.spawn(
      [
        "powershell", "-NoProfile", "-Command",
        `$f = [System.IO.File]::Open('${path}', 'Open', 'Read', 'Read'); ` +
          "[Console]::Out.WriteLine('locked'); [Console]::Out.Flush(); Start-Sleep -Seconds 600",
      ],
      { stdout: "pipe" },
    );
    const reader = holder.stdout.getReader();
    let said = "";
    while (!said.includes("locked")) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`PowerShell exited before locking the file: ${said}`);
      said += new TextDecoder().decode(value);
    }
    reader.releaseLock();
    return holder;
  }

  test("is kept as a Pending copy, then swapped in once the Video is closed", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const holder = await holdOpen(video);
    const elevenLabs = await fakeElevenLabs(wordsReply());
    const world = await makeWorld(elevenLabs.fetch);

    const first = await runTranscription(requestFor(video), world);
    holder.kill();
    await holder.exited;

    const message = "The subtitles are ready. Click Reload video to add them.";
    expect(first).toEqual({ kind: "pending", message });
    expect(world.notifications).toEqual(["The subtitles are ready. Open Kakitori and click Reload video to add them."]);
    expect(await readStatus(world)).toMatchObject({ state: "pending", message });
    expect(world.waits).toEqual([]);
    expect(await filesIn(dir)).toEqual(["lesson.kakitori.tmp.mp4", "lesson.mp4"]);

    const second = await runTranscription(requestFor(video, "t2"), world);

    expect(second).toEqual({ kind: "done", message: "Japanese subtitles added to lesson.mp4" });
    expect(elevenLabs.calls).toHaveLength(1);
    expect(await filesIn(dir)).toEqual(["lesson.mp4"]);
  });
});

describe("a Video that already has a Subtitle track", () => {
  test("is never transcribed again", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const elevenLabs = await fakeElevenLabs(wordsReply());
    await runTranscription(requestFor(video), await makeWorld(elevenLabs.fetch));
    const bytes = await Bun.file(video).bytes();
    const world = await makeWorld(elevenLabs.fetch);

    const outcome = await runTranscription(requestFor(video, "t2"), world);

    const message = "Japanese subtitles are already in lesson.mp4";
    expect(outcome).toEqual({ kind: "already-subtitled", message });
    expect(world.notifications).toEqual([message]);
    expect(elevenLabs.calls).toHaveLength(1);
    expect(await readStatus(world)).toMatchObject({ id: "t2", state: "done", message });
    expect(await Bun.file(video).bytes()).toEqual(bytes);
  });
});

describe("a Video moved while it is transcribed", () => {
  test("says so, leaves the moved Video untouched and nothing behind", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const moved = join(await tempDir(), "lesson.mp4");
    const elevenLabs = await fakeElevenLabs(() => {
      renameSync(video, moved);
      return wordsReply();
    });
    const bytes = await Bun.file(video).bytes();
    const world = await makeWorld(elevenLabs.fetch);

    const outcome = await runTranscription(requestFor(video), world);

    const message = "The video was moved or deleted during the transcription. Open it again in VLC and transcribe it again.";
    expect(outcome).toEqual({ kind: "error", message });
    expect(world.notifications).toEqual([message]);
    expect(await readStatus(world)).toMatchObject({ state: "error", message });
    expect(await Bun.file(moved).bytes()).toEqual(bytes);
    expect(await filesIn(dir)).toEqual([]);
  });
});

describe("Transcribe again", () => {
  // さようなら。 spoken from 0.2 s to 1.0 s.
  const OTHER_WORDS = [{ text: "さようなら。", start: 0.2, end: 1.0, type: "word" as const }];
  const OTHER_SRT = "1\n00:00:00,000 --> 00:00:01,700\nさようなら。\n\n";

  test("replaces the Subtitle track with a new one, keeping every other stream", async () => {
    const dir = await tempDir();
    const existing = "1\n00:00:00,500 --> 00:00:01,500\nHello\n\n";
    const video = await makeVideo(dir, "lesson.mp4", { subtitleSrt: existing });
    const elevenLabs = await fakeElevenLabs(wordsReply(), wordsReply(OTHER_WORDS));
    await runTranscription(requestFor(video), await makeWorld(elevenLabs.fetch));
    const world = await makeWorld(elevenLabs.fetch);

    const outcome = await runTranscription(requestFor(video, "t2", true), world);

    const message = "Japanese subtitles replaced in lesson.mp4";
    expect(outcome).toEqual({ kind: "done", message });
    expect(await readStatus(world)).toMatchObject({ state: "done", message });
    expect(elevenLabs.calls).toHaveLength(2);
    const after = await probe(video);
    expect(after.streams.map((s) => `${s.codec_type}:${s.codec_name}`)).toEqual([
      "video:mpeg4",
      "audio:aac",
      "subtitle:mov_text",
      "subtitle:mov_text",
    ]);
    expect(after.streams.filter((s) => s.tags?.language === "jpn" && s.codec_type === "subtitle")).toHaveLength(1);
    expect(await subtitleText(video, 0)).toBe(existing);
    expect(await subtitleText(video, 1)).toBe(OTHER_SRT);
    expect(await filesIn(dir)).toEqual(["lesson.mp4"]);
  });

  test("of a Video without a Subtitle track is an ordinary Transcription", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const world = await makeWorld((await fakeElevenLabs(wordsReply())).fetch);

    const outcome = await runTranscription(requestFor(video, "t1", true), world);

    expect(outcome).toEqual({ kind: "done", message: "Japanese subtitles added to lesson.mp4" });
    expect(await subtitleText(video, 0)).toBe(WORDS_SRT);
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

      const outcome = await runTranscription(requestFor(video), world);

      expect(outcome).toEqual({ kind: "error", message });
      expect(elevenLabs.calls).toHaveLength(0);
      expect(world.notifications).toEqual([message]);
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

      const outcome = await runTranscription(requestFor(video), world);

      expect(outcome).toEqual({ kind: "error", message });
      expect(elevenLabs.calls).toHaveLength(calls);
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

    const outcome = await runTranscription(requestFor(video), world);

    expect(outcome.kind).toBe("done");
    expect(elevenLabs.calls).toHaveLength(3);
    expect(world.waits).toEqual([2000, 4000]);
  });

  test("a failure that isn't retried waits for nothing", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const world = await makeWorld((await fakeElevenLabs(timeoutError())).fetch);

    await runTranscription(requestFor(video), world);

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

    const outcome = await runTranscription(requestFor(video, "t2"), world);

    expect(outcome).toEqual({ kind: "error", message: "A transcription is already running." });
    expect(world.notifications).toEqual(["A transcription is already running."]);
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

    const outcome = await runTranscription(requestFor(video), world);

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

    await runTranscription(requestFor(video), world);
    appendFileSync(states, `${statusNow().state}\n`);

    const seen = (await Bun.file(states).text()).trim().split("\n");
    expect(seen.filter((state, i) => state !== seen[i - 1])).toEqual(["extracting", "transcribing", "muxing", "done"]);
  });

});

describe("the notification", () => {
  test("comes last, once the status is final and the lock released", async () => {
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
    world.notify = async () => {
      seen.push({ state: statusNow().state, locked: lockedNow() });
    };

    await runTranscription(requestFor(video), world);

    expect(seen).toEqual([
      { state: "transcribing", locked: true },
      { state: "done", locked: false },
    ]);
  });

  test("that fails to show is logged, and the result is still in the status", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const world = await makeWorld((await fakeElevenLabs(wordsReply())).fetch);
    world.notify = async () => {
      throw new Error("osascript exited with 1");
    };

    const outcome = await runTranscription(requestFor(video), world);

    expect(outcome.kind).toBe("done");
    expect(await readStatus(world)).toMatchObject({ state: "done", message: "Japanese subtitles added to lesson.mp4" });
    expect(await Bun.file(join(world.stateDir, "log.txt")).text()).toContain("osascript exited with 1");
  });
});

describe("the log", () => {
  test("records each Transcription but never the API key", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const key = "sk_live_very_secret_123";
    const rejected = Response.json({ detail: { message: "Invalid API key" } }, { status: 401 });
    const world = await makeWorld((await fakeElevenLabs(rejected, wordsReply())).fetch, key);

    await runTranscription(requestFor(video), world);
    await runTranscription(requestFor(video, "t2"), world);

    const log = await Bun.file(join(world.stateDir, "log.txt")).text();
    expect(log).toContain("[t1]");
    expect(log).toContain("[t2]");
    expect(log).not.toContain(key);
  });

});

describe("the API key", () => {
  test("with no key saved, the Transcription stops before anything is uploaded", async () => {
    const dir = await tempDir();
    const video = await makeVideo(dir, "lesson.mp4");
    const elevenLabs = await fakeElevenLabs(wordsReply());
    const world = await makeWorld(elevenLabs.fetch);
    await rm(join(world.stateDir, "config.json"));

    const outcome = await runTranscription(requestFor(video), world);

    expect(outcome).toEqual({ kind: "error", message: "No API key saved. Use Change API key." });
    expect(elevenLabs.calls).toHaveLength(0);
  });
});
