import { QUIET_FFMPEG, runProcess } from "./process.ts";

export async function extractAudio(ffmpeg: string, video: string, audioIndex: number, out: string) {
  const base = [ffmpeg, ...QUIET_FFMPEG, "-i", video, "-vn", "-map", `0:a:${audioIndex}`];
  const copied = await runProcess([...base, "-c:a", "copy", out]);
  if (copied.code === 0) return;
  const encoded = await runProcess([...base, "-ac", "1", "-c:a", "aac", "-b:a", "64k", out]);
  if (encoded.code !== 0) throw new Error(`Audio extraction failed: ${encoded.stderr.trim()}`);
}
