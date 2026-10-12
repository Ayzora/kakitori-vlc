// What ffprobe can tell about a Video or a copy of it.

import { runProcess } from "./process.ts";

export type Stream = {
  index: number;
  codec_type: string;
  codec_name?: string;
  codec_tag_string?: string;
  tags?: Record<string, string>;
};

export type VideoInfo = {
  streams: Stream[];
  duration: number;
  tags: Record<string, string>;
};

export async function inspect(ffprobe: string, path: string): Promise<VideoInfo> {
  const result = await runProcess([
    ffprobe,
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    path,
  ]);
  if (result.code !== 0) throw new Error(`ffprobe failed on ${path}: ${result.stderr.trim()}`);
  const json = JSON.parse(result.stdout);
  return {
    streams: json.streams ?? [],
    duration: Number(json.format?.duration ?? 0),
    tags: json.format?.tags ?? {},
  };
}

export function streamsOfType(info: VideoInfo, type: string) {
  return info.streams.filter((s) => s.codec_type === type);
}

// Position among the audio streams of the track to transcribe: the first one
// tagged Japanese, otherwise the first one.
export function japaneseAudioIndex(info: VideoInfo) {
  const audio = streamsOfType(info, "audio");
  const japanese = audio.findIndex((s) => s.tags?.language === "jpn");
  return japanese === -1 ? 0 : japanese;
}

// The mark of a Video Kakitori has already subtitled: a Japanese subtitle
// track labelled "Japanese". (A file-level tag would need ffmpeg's
// use_metadata_tags, which hides the title from Apple's players.)
export function hasSubtitleTrack(info: VideoInfo) {
  return streamsOfType(info, "subtitle").some(
    (s) => s.tags?.language === "jpn" && s.tags?.handler_name === "Japanese",
  );
}
