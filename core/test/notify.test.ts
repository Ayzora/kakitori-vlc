import { describe, expect, test } from "bun:test";
import { windowsNotification } from "../src/notify.ts";

describe("the Windows notification", () => {
  // PowerShell ends a '…' string at ’ and ‘ too, so a file name could escape it.
  const hostile = "Japanese subtitles added to Don’t; Start-Process calc; ‘x'.mp4";

  test("never puts the message into the PowerShell script", () => {
    const plain = windowsNotification("Japanese subtitles added to lesson.mp4");
    const crafted = windowsNotification(hostile);

    expect(crafted.cmd).toEqual(plain.cmd);
    const script = Buffer.from(crafted.cmd.at(-1)!, "base64").toString("utf16le");
    expect(script).not.toContain("Start-Process calc");
  });

  test("hands the message over unchanged, Japanese and all", () => {
    const message = "Japanese subtitles added to 第3話 新しいルール.mp4. Open Kakitori and click Reload video.";

    expect(windowsNotification(message).env.KAKITORI_NOTIFICATION).toBe(message);
    expect(windowsNotification(hostile).env.KAKITORI_NOTIFICATION).toBe(hostile);
  });
});
