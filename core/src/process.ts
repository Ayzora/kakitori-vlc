export type ProcessResult = { code: number; stdout: string; stderr: string };

// Runs a program to the end. Arguments go straight to the OS, never through a
// shell, so paths with spaces or Japanese characters need no quoting.
export async function runProcess(cmd: string[]): Promise<ProcessResult> {
  const child = Bun.spawn(cmd, {
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
