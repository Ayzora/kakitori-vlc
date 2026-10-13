export type ProcessResult = { code: number; stdout: string; stderr: string };

// Runs a program to the end. Arguments go straight to the OS, never through a
// shell, so paths with spaces or Japanese characters need no quoting. `env`
// replaces the environment when given.
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

// Leading ffmpeg options for every call: no prompts, errors only, overwrite.
export const QUIET_FFMPEG = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y"];
