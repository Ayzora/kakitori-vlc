import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { takeRequest } from "../src/request.ts";
import { tempDir } from "./helpers.ts";

describe("the extension's request in job.json", () => {
  test("names the Video VLC is playing by its URI, Japanese name and all", async () => {
    const stateDir = await tempDir();
    const video = join(await tempDir(), "第3話 新しいルール.mp4");
    const videoUri = pathToFileURL(video).href;
    await Bun.write(join(stateDir, "job.json"), JSON.stringify({ id: "r1", createdAt: 1, videoUri }));

    expect(await takeRequest(stateDir)).toEqual({ id: "r1", videoPath: video, videoUri, replace: false });
  });

  test("asks to replace the Subtitle track only when replace is true", async () => {
    const stateDir = await tempDir();
    const videoUri = pathToFileURL(join(stateDir, "lesson.mp4")).href;
    await Bun.write(join(stateDir, "job.json"), JSON.stringify({ id: "r1", createdAt: 1, videoUri, replace: true }));

    expect((await takeRequest(stateDir))?.replace).toBe(true);
  });

  test("is deleted as soon as it is read, so it runs once", async () => {
    const stateDir = await tempDir();
    const videoUri = pathToFileURL(join(stateDir, "lesson.mp4")).href;
    await Bun.write(join(stateDir, "job.json"), JSON.stringify({ id: "r1", createdAt: 1, videoUri }));

    await takeRequest(stateDir);

    expect(existsSync(join(stateDir, "job.json"))).toBe(false);
    expect(await takeRequest(stateDir)).toBeNull();
  });

  test("without a file URI is logged and ignored", async () => {
    const stateDir = await tempDir();
    await Bun.write(join(stateDir, "job.json"), JSON.stringify({ id: "r1", createdAt: 1, videoUri: "https://example.com/a.mp4" }));

    expect(await takeRequest(stateDir)).toBeNull();
    expect(await Bun.file(join(stateDir, "log.txt")).text()).toContain("ignoring unreadable job.json");
  });
});
