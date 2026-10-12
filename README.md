# Kakitori for VLC

Kakitori adds Japanese subtitles to your own Japanese videos, right from VLC. Queue an MP4, M4V or MOV, click **Transcribe**, and keep watching. Kakitori sends the video's audio to [ElevenLabs](https://elevenlabs.io) Scribe v2, builds Japanese subtitles from the result, and adds them as a subtitle track **inside the same video file**. A popup tells you when it's done.

The subtitles then show up in VLC (Subtitle → Sub Track → Japanese), QuickTime, the Apple TV app and Films & TV, and they travel with the file wherever you copy it.

Works with VLC 3.0.x on Windows x64 and macOS (Apple Silicon and Intel).

## Before you start: what you're agreeing to

- **You bring your own ElevenLabs API key**, and every transcription is billed to your ElevenLabs account. Get a key at [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys).
- **Your video's audio is uploaded to ElevenLabs** to be transcribed. Only the audio is sent, never the picture. See [ElevenLabs' privacy policy](https://elevenlabs.io/privacy-policy).
- **Your API key is stored in plain text** on your computer, in `config.json` inside Kakitori's folder (see [Where things live](#where-things-live)). On macOS only your user account can read that file.
- **Kakitori rewrites your video file in place.** It adds one subtitle track and keeps everything else: the picture, every audio track, existing subtitles, the title and the modified date. Some details are lost:
  - On macOS, Finder tags, Finder comments and the file's creation date are lost.
  - If a video holds extra camera data that can't be copied (some iPhone clips do), that data is removed, and the popup says so.
- **A video is never transcribed twice.** Once it has Kakitori's Japanese track, clicking Transcribe again just tells you the subtitles are already there.
- **A transcription that times out may still be billed.** If ElevenLabs takes longer than 15 minutes, Kakitori gives up and doesn't retry, because ElevenLabs may still finish (and charge for) the first attempt.
- **Local drives only.** v1 supports videos on your computer's own drive, not iCloud Drive, network shares or exFAT external drives.

## Install

**macOS** (in Terminal):

```sh
curl -fsSL https://github.com/<owner>/kakitori-vlc/releases/latest/download/install.sh | sh
```

**Windows** (in PowerShell):

```powershell
irm https://github.com/<owner>/kakitori-vlc/releases/latest/download/install.ps1 | iex
```

The installer:

1. Downloads the build for your computer and checks it against the release's checksums.
2. Copies the extension into VLC's extensions folder.
3. Copies Kakitori's programs (the Kakitori core, ffmpeg and ffprobe) into Kakitori's folder.

Then restart VLC.

Run the same command again to upgrade. Your saved API key is kept.

### Security warnings

Kakitori's programs aren't signed by Apple or Microsoft.

- **macOS:** the installer clears the download "quarantine" flag so Gatekeeper doesn't block the programs. If macOS still refuses to open `kakitori`, open System Settings → Privacy & Security and choose **Open Anyway**.
- **Windows:** SmartScreen or your antivirus may warn about or block `kakitori.exe`. If **Show last status** says "Kakitori didn't start", allow `kakitori.exe` in your antivirus (it lives in `%APPDATA%\vlc\kakitori\bin`) and try again.

## Use

1. Add a video to VLC's playlist **without playing it**: drag it in, or use Media → Open with **Enqueue**.
2. Click **View → Kakitori → Transcribe** (macOS: **VLC → Extensions → Kakitori → Transcribe**).
3. The first time, paste your ElevenLabs API key and click **Save**.
4. Check the file name and length, then click **Start**. VLC stays usable while Kakitori works.
5. When the popup says "Japanese subtitles added to …", reopen the video and pick the Japanese track under **Subtitle → Sub Track**.

Kakitori always takes the **most recently added** MP4, M4V or MOV in the playlist. Other file types are skipped.

Other menu items:

- **Change API key**: replace a rejected or rotated key.
- **Show last status**: what Kakitori is doing now, or how the last transcription ended.

### If the video is open in VLC (Windows)

Windows doesn't let Kakitori replace a video that VLC has open. Kakitori waits up to 2 minutes for you to close it. If it's still open, Kakitori keeps the finished file next to your video as `<name>.kakitori.tmp.<ext>`, which is as large as the video, and says "Close the video in VLC, then click Transcribe again." Do that, and Kakitori swaps the finished file in without contacting ElevenLabs again. If you never come back for it, you can delete that file yourself.

## What the messages mean

| Message | What to do |
| --- | --- |
| API key rejected. Use Change API key. | Paste a valid key with **Change API key**. |
| *(ElevenLabs' own text about credits or limits)* | Check your ElevenLabs plan. Kakitori doesn't retry these. |
| ElevenLabs can't transcribe videos longer than 10 hours. / The audio is larger than ElevenLabs' 3 GB upload limit. | Split the video; nothing was uploaded. |
| Couldn't reach ElevenLabs. Check your internet connection. | Kakitori already retried 3 times. Try again later. |
| ElevenLabs had a problem. Try again later. | ElevenLabs' servers failed 4 times in a row. |
| ElevenLabs took too long. Try again later. | No answer within 15 minutes. This attempt may still be billed. |
| No audio track found. | The video has no sound to transcribe. |
| The video file can't be found. | It was moved, renamed or deleted after you queued it. Queue it again. |
| No API key saved. Use Change API key. | Save your key with **Change API key**. |
| Couldn't add the subtitles to this file. | ffmpeg couldn't write a complete copy. Your video is untouched; details are in `log.txt`. |
| Something went wrong. See the log for details. | Unexpected error; your video is untouched. Details are in `log.txt`. |
| Subtitles can't be added to this file type. | Only MP4, M4V and MOV are supported. |
| Not enough free space next to the Video. | Kakitori needs free space as large as the video while it works. |
| A transcription is already running. | Wait for the current one to finish. |
| Kakitori is still starting the last transcription. … | Wait a few seconds and click Transcribe again. |
| Close the video in VLC, then click Transcribe again. | See [If the video is open in VLC](#if-the-video-is-open-in-vlc-windows). |
| Kakitori didn't start. … | See [Security warnings](#security-warnings). |

## Where things live

| | macOS | Windows |
| --- | --- | --- |
| Extension | `~/Library/Application Support/org.videolan.vlc/lua/extensions/kakitori.lua` | `%APPDATA%\vlc\lua\extensions\kakitori.lua` |
| Kakitori's folder | `~/Library/Application Support/org.videolan.vlc/kakitori/` | `%APPDATA%\vlc\kakitori\` |

Kakitori's folder holds `config.json` (your API key), `status.json` (the last status), `log.txt` (a run log that never contains your key) and `bin/` (the programs).

## Uninstall

**macOS:**

```sh
curl -fsSL https://github.com/<owner>/kakitori-vlc/releases/latest/download/uninstall.sh | sh
```

**Windows:**

```powershell
irm https://github.com/<owner>/kakitori-vlc/releases/latest/download/uninstall.ps1 | iex
```

This stops any running transcription, then removes the extension and Kakitori's whole folder, including your saved API key. Subtitle tracks already added to your videos stay in those files.

## For developers

The core is TypeScript, run and compiled with [Bun](https://bun.com):

```sh
cd core
bun install
bun run fetch-ffmpeg        # static ffmpeg + ffprobe for tests, into core/vendor
bun test
bun check
bun src/index.ts video.mp4  # transcribe one video from a terminal (ELEVENLABS_API_KEY or the saved key)
```

The installers can be tested against a local build by setting `KAKITORI_BASE_URL` to a `file://` folder that holds the zip and `SHA256SUMS.txt`.

Pushing a tag such as `v1.0.0` builds all three platforms and publishes a GitHub Release (`.github/workflows/release.yml`).

Design notes: `CONTEXT.md` (terms), `docs/adr/` (decisions), and the spec in `.scratch/kakitori-vlc-v1/spec.md`.

## License

MIT; see [LICENSE](LICENSE). Kakitori bundles ffmpeg; see [THIRD_PARTY.md](THIRD_PARTY.md).
