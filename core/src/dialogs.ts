// The core's own windows: the file picker, the Start / Cancel question and the
// popup. osascript on macOS; PowerShell with Windows Forms on Windows.
//
// The core runs in the background, so every window is brought to the front:
// osascript's `activate`, and a topmost owner window on Windows.

import { runProcess, type ProcessResult } from "./process.ts";

export async function showPopup(message: string): Promise<void> {
  if (process.platform === "darwin") {
    await mustSucceed(await osascript(
      'display dialog (item 1 of argv) with title "Kakitori" buttons {"OK"} default button "OK"',
      message,
    ));
  } else if (process.platform === "win32") {
    await mustSucceed(await powershell(
      `[void][System.Windows.Forms.MessageBox]::Show($owner, ${psString(message)}, 'Kakitori')`,
    ));
  } else {
    console.log(message);
  }
}

export async function confirm(question: string): Promise<boolean> {
  if (process.platform === "darwin") {
    const result = await osascript(
      'display dialog (item 1 of argv) with title "Kakitori" buttons {"Cancel", "Start"} default button "Start" cancel button "Cancel"',
      question,
    );
    if (isUserCancel(result)) return false;
    await mustSucceed(result);
    return true;
  }
  if (process.platform === "win32") {
    const result = await powershell(
      `[Console]::Out.Write([System.Windows.Forms.MessageBox]::Show($owner, ${psString(question)}, 'Kakitori', 'OKCancel', 'Question'))`,
    );
    await mustSucceed(result);
    return result.stdout.trim() === "OK";
  }
  return true;
}

// Only MP4, M4V and MOV can be picked.
export async function chooseVideo(): Promise<string | null> {
  if (process.platform === "darwin") {
    const result = await osascript(
      'POSIX path of (choose file with prompt "Choose a video to transcribe" of type ' +
        '{"public.mpeg-4", "com.apple.m4v-video", "com.apple.quicktime-movie"})',
    );
    if (isUserCancel(result)) return null;
    await mustSucceed(result);
    return result.stdout.replace(/\r?\n$/, "") || null;
  }
  if (process.platform === "win32") {
    const result = await powershell(
      "$d = New-Object System.Windows.Forms.OpenFileDialog; " +
        "$d.Title = 'Choose a video to transcribe'; " +
        "$d.Filter = 'Videos (*.mp4, *.m4v, *.mov)|*.mp4;*.m4v;*.mov'; " +
        "if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($d.FileName) }",
    );
    await mustSucceed(result);
    return result.stdout.trim() || null;
  }
  throw new Error("The file picker needs macOS or Windows. Pass the video as an argument instead.");
}

// The script gets its arguments as `argv`, so text is never spliced into it.
function osascript(script: string, ...args: string[]) {
  return runProcess(["osascript", "-e", "on run argv", "-e", "activate", "-e", script, "-e", "end run", ...args]);
}

// "User canceled." (error -128) when the user clicks Cancel.
function isUserCancel(result: ProcessResult) {
  return result.code !== 0 && result.stderr.includes("(-128)");
}

// -EncodedCommand carries the script as UTF-16, so Japanese text survives, and
// stdout is UTF-8 so a picked Japanese path comes back intact.
function powershell(script: string) {
  const full =
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; " +
    "Add-Type -AssemblyName System.Windows.Forms; " +
    "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }; " +
    script;
  const encoded = Buffer.from(full, "utf16le").toString("base64");
  return runProcess([
    "powershell", "-NoProfile", "-NonInteractive", "-STA", "-WindowStyle", "Hidden", "-EncodedCommand", encoded,
  ]);
}

function psString(text: string) {
  return `'${text.replace(/'/g, "''")}'`;
}

async function mustSucceed(result: ProcessResult) {
  if (result.code !== 0) throw new Error(`exited with ${result.code}: ${result.stderr.trim()}`);
}
