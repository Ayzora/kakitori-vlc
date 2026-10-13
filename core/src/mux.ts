// Writes the working copy (the Video plus the Subtitle track) and checks a
// copy before it may replace the Video.

import { rm } from "node:fs/promises";
import { extname } from "node:path";
import { QUIET_FFMPEG, runProcess } from "./process.ts";
import { Refusal } from "./refusal.ts";
import { hasSubtitleTrack, inspect, isSubtitleTrack, streamsOfType, type Stream, type VideoInfo } from "./video.ts";

export type Tools = { ffmpeg: string; ffprobe: string };

// What checking a copy against its Video found.
export type CopyCheck = {
  // Every stream of the Video with the same codec, in order, plus the new
  // Subtitle track, and the same length to within a second.
  complete: boolean;
  dataRemoved: boolean;
  description: string;
};

// Data streams may be missing only when `allowMissingData`, i.e. after the
// camera-data retry, or for a Pending copy, which can't say whether it had one.
// When `replace`, the Video's own Subtitle track must be gone from the copy.
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
  const expected = [...video.streams.filter((s) => kept(s) && !replaced(s)).map(signature), "subtitle:mov_text"];
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

// Copies every stream of the Video, except its old Subtitle track when
// `replace`, and adds the SRT as a mov_text track. If that fails (e.g. iPhone
// camera data ffmpeg can't copy), tries once more without data streams. A
// copy that fails the check is deleted.
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
  // Keep the Video's container and brand.
  const format = extname(videoPath).toLowerCase() === ".mov" ? "mov" : "mp4";
  const brand = video.tags.major_brand ? ["-brand", video.tags.major_brand] : [];
  // ffmpeg drops the recording date when copying tags, so carry it over.
  const created = video.tags.creation_time ? ["-metadata", `creation_time=${video.tags.creation_time}`] : [];
  return runProcess([
    ffmpeg, ...QUIET_FFMPEG,
    "-i", videoPath, "-i", srt,
    "-map", "0", ...(withoutData ? ["-map", "-0:d?"] : []),
    ...replaced.flatMap((s) => ["-map", `-0:${s.index}`]),
    "-map", "1",
    "-c", "copy", `-c:s:${n}`, "mov_text",
    `-metadata:s:s:${n}`, "language=jpn",
    `-metadata:s:s:${n}`, "handler_name=Japanese",
    ...created,
    ...brand,
    "-f", format, out,
  ]);
}
