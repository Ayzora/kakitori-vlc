import { rm } from "node:fs/promises";
import { extname } from "node:path";
import { QUIET_FFMPEG, runProcess } from "./process.ts";
import { Refusal } from "./refusal.ts";
import { hasSubtitleTrack, inspect, isSubtitleTrack, streamsOfType, type Stream, type VideoInfo } from "./video.ts";

export type Tools = { ffmpeg: string; ffprobe: string };

export type CopyCheck = {
  complete: boolean;
  dataRemoved: boolean;
  description: string;
};

export async function checkCopy(
  ffprobe: string,
  video: VideoInfo,
  copyPath: string,
  allowMissingData: boolean,
  replace: boolean,
): Promise<CopyCheck> {
  const copy = await inspect(ffprobe, copyPath);
  const kept = (s: Stream) => !allowMissingData || s.codec_type !== "data";
  const replaced = (s: Stream) => replace && isSubtitleTrack(s);
  const subtitle = `subtitle:${containerOf(copyPath).subtitleCodec}`;
  const expected = [...video.streams.filter((s) => kept(s) && !replaced(s)).map(signature), subtitle];
  const actual = copy.streams.filter(kept).map(signature);
  const complete =
    hasSubtitleTrack(copy) &&
    actual.length === expected.length &&
    actual.every((s, i) => s === expected[i]) &&
    Math.abs(copy.duration - video.duration) <= 1;
  return {
    complete,
    dataRemoved: streamsOfType(copy, "data").length < streamsOfType(video, "data").length,
    description: `copy ${describeStreams(copy)} vs Video ${describeStreams(video)}`,
  };
}

export async function makeWorkingCopy(
  tools: Tools,
  videoPath: string,
  video: VideoInfo,
  srt: string,
  copyPath: string,
  replace: boolean,
): Promise<{ dataRemoved: boolean }> {
  let result = await mux(tools.ffmpeg, videoPath, video, srt, copyPath, false, replace);
  let withoutData = false;
  if (result.code !== 0) {
    withoutData = true;
    result = await mux(tools.ffmpeg, videoPath, video, srt, copyPath, true, replace);
  }
  let problem: Error | null = result.code === 0 ? null : new Error(result.stderr.trim());
  let check: CopyCheck | null = null;
  if (!problem) {
    try {
      check = await checkCopy(tools.ffprobe, video, copyPath, withoutData, replace);
      if (!check.complete) problem = new Error(`Working copy failed the check: ${check.description}`);
    } catch (error) {
      problem = error as Error;
    }
  }
  if (problem || !check) {
    await rm(copyPath, { force: true });
    throw new Refusal("Couldn't add the subtitles to this file.", { cause: problem });
  }
  return { dataRemoved: check.dataRemoved };
}

function containerOf(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === ".mkv") return { format: "matroska", subtitleCodec: "subrip", brand: false };
  return { format: ext === ".mov" ? "mov" : "mp4", subtitleCodec: "mov_text", brand: true };
}

function signature(s: Stream) {
  return `${s.codec_type}:${s.codec_name ?? s.codec_tag_string ?? "?"}`;
}

function describeStreams(info: VideoInfo) {
  return `[${info.streams.map(signature).join(", ")}] ${info.duration}s`;
}

function mux(
  ffmpeg: string,
  videoPath: string,
  video: VideoInfo,
  srt: string,
  out: string,
  withoutData: boolean,
  replace: boolean,
) {
  const replaced = replace ? video.streams.filter(isSubtitleTrack) : [];
  const n = streamsOfType(video, "subtitle").length - replaced.length;
  const container = containerOf(videoPath);
  const brand = container.brand && video.tags.major_brand ? ["-brand", video.tags.major_brand] : [];
  const title = container.format === "matroska" ? [`-metadata:s:s:${n}`, "title=Japanese"] : [];
  const created = video.tags.creation_time ? ["-metadata", `creation_time=${video.tags.creation_time}`] : [];
  return runProcess([
    ffmpeg, ...QUIET_FFMPEG,
    "-i", videoPath, "-i", srt,
    "-map", "0", ...(withoutData ? ["-map", "-0:d?"] : []),
    ...replaced.flatMap((s) => ["-map", `-0:${s.index}`]),
    "-map", "1",
    "-c", "copy", `-c:s:${n}`, container.subtitleCodec,
    `-metadata:s:s:${n}`, "language=jpn",
    `-metadata:s:s:${n}`, "handler_name=Japanese",
    ...title,
    ...created,
    ...brand,
    "-f", container.format, out,
  ]);
}
