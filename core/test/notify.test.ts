import { describe, expect, test } from "bun:test";
import { linuxNotification, windowsNotification } from "../src/notify.ts";

describe("the Windows notification", () => {
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

describe("the Linux notification", () => {
  test("hands the message over as one argument, even when it looks like an option", () => {
    const message = "--icon=/tmp/x Japanese subtitles added to 第3話.mp4";

    expect(linuxNotification(message)).toEqual(["notify-send", "--app-name=Kakitori", "--", "Kakitori", message]);
  });
});
