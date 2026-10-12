// Writes the working copy (the Video plus the Subtitle track) and checks it
// before it may replace the Video.

import { rm } from "node:fs/promises";
import { extname } from "node:path";
import { runProcess } from "./process.ts";
import { Refusal } from "./refusal.ts";
import { inspect, streamsOfType, type Stream, type VideoInfo } from "./video.ts";

export type WorkingCopy = { dataRemoved: boolean };

// Copies every stream of the Video and adds the SRT as a mov_text track. If
// that fails (e.g. iPhone camera data ffmpeg can't copy), tries once more
// without data streams.
export async function makeWorkingCopy(
  ffmpeg: string,
  ffprobe: string,
  video: string,
  info: VideoInfo,
  srt: string,
  out: string,
): Promise<WorkingCopy> {
  let result = await mux(ffmpeg, video, info, srt, out, false);
  let withoutData = false;
  if (result.code !== 0) {
    withoutData = true;
    result = await mux(ffmpeg, video, info, srt, out, true);
  }
  if (result.code !== 0) {
    await rm(out, { force: true });
    throw new Refusal("Couldn't add the subtitles to this file.", { cause: new Error(result.stderr.trim()) });
  }
  const copy = await inspect(ffprobe, out).catch(async (error) => {
    await rm(out, { force: true });
    throw error;
  });
  if (!isCompleteCopy(info, copy, withoutData)) {
    await rm(out, { force: true });
    throw new Refusal("Couldn't add the subtitles to this file.", {
      cause: new Error(`Working copy failed the check: ${describeStreams(copy)} vs ${describeStreams(info)}`),
    });
  }
  return { dataRemoved: dataRemoved(info, copy) };
}

// Every stream of the Video with the same codec, in order, plus exactly one
// new subtitle stream, and the same length to within a second. Only data
// streams may be missing, and only when allowed.
export function isCompleteCopy(video: VideoInfo, copy: VideoInfo, allowMissingData: boolean) {
  const kept = (s: Stream) => !allowMissingData || s.codec_type !== "data";
  const expected = [...video.streams.filter(kept).map(signature), "subtitle:mov_text"];
  const actual = copy.streams.filter(kept).map(signature);
  return (
    actual.length === expected.length &&
    actual.every((s, i) => s === expected[i]) &&
    Math.abs(copy.duration - video.duration) <= 1
  );
}

export function dataRemoved(video: VideoInfo, copy: VideoInfo) {
  return streamsOfType(copy, "data").length < streamsOfType(video, "data").length;
}

function signature(s: Stream) {
  return `${s.codec_type}:${s.codec_name ?? s.codec_tag_string ?? "?"}`;
}

function describeStreams(info: VideoInfo) {
  return `[${info.streams.map(signature).join(", ")}] ${info.duration}s`;
}

function mux(ffmpeg: string, video: string, info: VideoInfo, srt: string, out: string, withoutData: boolean) {
  const n = streamsOfType(info, "subtitle").length;
  // Keep the Video's container and brand.
  const format = extname(video).toLowerCase() === ".mov" ? "mov" : "mp4";
  const brand = info.tags.major_brand ? ["-brand", info.tags.major_brand] : [];
  // ffmpeg drops the recording date when copying tags, so carry it over.
  const created = info.tags.creation_time ? ["-metadata", `creation_time=${info.tags.creation_time}`] : [];
  return runProcess([
    ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-i", video, "-i", srt,
    "-map", "0", ...(withoutData ? ["-map", "-0:d?"] : []), "-map", "1",
    "-c", "copy", `-c:s:${n}`, "mov_text",
    `-metadata:s:s:${n}`, "language=jpn",
    `-metadata:s:s:${n}`, "handler_name=Japanese",
    ...created,
    ...brand,
    "-f", format, out,
  ]);
}
