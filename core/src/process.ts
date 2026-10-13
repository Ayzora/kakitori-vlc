export type ProcessResult = { code: number; stdout: string; stderr: string };

export async function runProcess(cmd: string[], env?: Record<string, string | undefined>): Promise<ProcessResult> {
  const child = Bun.spawn(cmd, {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

export const QUIET_FFMPEG = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y"];
