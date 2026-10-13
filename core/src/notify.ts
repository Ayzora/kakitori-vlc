// The notification that tells the user a Transcription has ended. It fades
// away on its own, so nothing waits for a click. Built into the OS:
// osascript on macOS, PowerShell on Windows.
//
// The message (which holds the Video's file name) is never spliced into a
// script: osascript gets it as an argument and PowerShell as an environment
// variable, so no file name can be read as code.

import { runProcess } from "./process.ts";

export async function notify(message: string): Promise<void> {
  if (process.platform === "darwin") {
    const result = await runProcess([
      "osascript",
      "-e", "on run argv",
      "-e", 'display notification (item 1 of argv) with title "Kakitori"',
      "-e", "end run",
      message,
    ]);
    if (result.code !== 0) throw new Error(`osascript exited with ${result.code}: ${result.stderr.trim()}`);
  } else if (process.platform === "win32") {
    const { cmd, env } = windowsNotification(message);
    const result = await runProcess(cmd, env);
    if (result.code !== 0) throw new Error(`PowerShell exited with ${result.code}: ${result.stderr.trim()}`);
  }
}

// A balloon from a tray icon, which only shows while PowerShell is running.
// The script is fixed text; quoting the message into it would not be safe,
// because PowerShell also ends a '…' string at curly quotes such as ’.
const WINDOWS_SCRIPT =
  "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; " +
  "$n = New-Object System.Windows.Forms.NotifyIcon; " +
  "$n.Icon = [System.Drawing.SystemIcons]::Information; " +
  "$n.Visible = $true; " +
  "$n.ShowBalloonTip(10000, 'Kakitori', $env:KAKITORI_NOTIFICATION, 'Info'); " +
  "Start-Sleep -Seconds 10; $n.Dispose()";

export function windowsNotification(message: string) {
  // -EncodedCommand carries the script as UTF-16, so it reaches PowerShell intact.
  const encoded = Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64");
  return {
    cmd: ["powershell", "-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
    env: { ...process.env, KAKITORI_NOTIFICATION: message },
  };
}
