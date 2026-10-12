// The system popup: osascript on macOS, a PowerShell message box on Windows.

import { runProcess } from "./process.ts";

export async function showPopup(message: string): Promise<void> {
  if (process.platform === "darwin") {
    // The message is passed as an argument, never spliced into the script.
    await mustSucceed([
      "osascript",
      "-e", "on run argv",
      "-e", 'display dialog (item 1 of argv) with title "Kakitori" buttons {"OK"} default button "OK"',
      "-e", "end run",
      message,
    ]);
  } else if (process.platform === "win32") {
    // -EncodedCommand carries the script as UTF-16, so Japanese names survive.
    const quoted = message.replace(/'/g, "''");
    const script =
      "Add-Type -AssemblyName PresentationFramework; " +
      `[void][System.Windows.MessageBox]::Show('${quoted}', 'Kakitori')`;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    await mustSucceed([
      "powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded,
    ]);
  } else {
    console.log(message);
  }
}

async function mustSucceed(cmd: string[]) {
  const result = await runProcess(cmd);
  if (result.code !== 0) throw new Error(`${cmd[0]} exited with ${result.code}: ${result.stderr.trim()}`);
}
