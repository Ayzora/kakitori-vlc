// The notification that tells the user a Transcription has ended. It fades
// away on its own, so nothing waits for a click. Built into the OS:
// osascript on macOS, PowerShell on Windows.

import { runProcess } from "./process.ts";

export async function notify(message: string): Promise<void> {
  if (process.platform === "darwin") {
    // The message travels as an argument (argv), so it is never spliced into the script.
    const result = await runProcess([
      "osascript",
      "-e", "on run argv",
      "-e", 'display notification (item 1 of argv) with title "Kakitori"',
      "-e", "end run",
      message,
    ]);
    if (result.code !== 0) throw new Error(`osascript exited with ${result.code}: ${result.stderr.trim()}`);
  } else if (process.platform === "win32") {
    // A balloon from a tray icon, which only shows while PowerShell is running.
    // -EncodedCommand carries the script as UTF-16, so Japanese names survive.
    const script =
      "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; " +
      "$n = New-Object System.Windows.Forms.NotifyIcon; " +
      "$n.Icon = [System.Drawing.SystemIcons]::Information; " +
      "$n.Visible = $true; " +
      `$n.ShowBalloonTip(10000, 'Kakitori', ${psString(message)}, 'Info'); ` +
      "Start-Sleep -Seconds 10; $n.Dispose()";
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const result = await runProcess([
      "powershell", "-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-EncodedCommand", encoded,
    ]);
    if (result.code !== 0) throw new Error(`PowerShell exited with ${result.code}: ${result.stderr.trim()}`);
  }
}

function psString(text: string) {
  return `'${text.replace(/'/g, "''")}'`;
}
