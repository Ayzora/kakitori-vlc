# Kakitori for VLC

**Japanese subtitles for your own Japanese videos, made from inside VLC.**

Pick a video, click **Start**, and keep watching. Kakitori sends the video's audio to [ElevenLabs](https://elevenlabs.io) Scribe v2, turns the result into readable Japanese subtitles, and adds them as a subtitle track **inside the same video file**. A popup tells you when it's done.

The subtitles then work everywhere the file goes: VLC, QuickTime, the Apple TV app, and Films & TV on Windows.

- Works with **VLC 3.0.x** on **macOS** (Apple Silicon and Intel) and **Windows x64**.
- Supports **MP4, M4V and MOV** videos on your computer's own drive.

## What you need

1. **VLC 3.0.x** from [videolan.org](https://www.videolan.org/vlc/).
2. **An ElevenLabs API key.** Make one at [elevenlabs.io → API keys](https://elevenlabs.io/app/settings/api-keys). Transcriptions are billed to your ElevenLabs account.

## Install

**macOS:** open **Terminal** and paste:

```sh
curl -fsSL https://github.com/Ayzora/kakitori-vlc/releases/latest/download/install.sh | sh
```

**Windows:** open **PowerShell** and paste:

```powershell
irm https://github.com/Ayzora/kakitori-vlc/releases/latest/download/install.ps1 | iex
```

When it prints **Done**, quit VLC completely (macOS: **⌘Q**) and open it again.

To upgrade later, run the same command again. Your saved API key is kept.

<details>
<summary>What the installer does</summary>

1. Downloads the build for your computer and checks it against the release's checksums. If anything doesn't match, it stops and installs nothing.
2. Copies the extension, `kakitori.lua`, into VLC's extensions folder.
3. Copies Kakitori's programs into Kakitori's own folder: the Kakitori core, plus ffmpeg and ffprobe, which handle the video files.
4. On macOS, clears the "downloaded from the internet" flag so Gatekeeper doesn't block those programs.

</details>

## Your first transcription

1. Open the Kakitori window:
   - **macOS:** **VLC → Extensions → Kakitori**
   - **Windows:** **View → Kakitori**
2. Click **Choose video…**.
3. **First time only:** paste your ElevenLabs API key and click **Save**.
4. In the Open window, pick your video. On a Mac you can also drag it in from Finder.
5. Kakitori asks **"Transcribe <name> (length)?"**. Click **Start**.
6. Keep using VLC. When the popup says **"Japanese subtitles added to …"**, open the video and choose **Subtitle → Sub Track → Japanese**.

The Kakitori window has two more buttons:

- **Change API key:** paste a new key, for example after "API key rejected".
- **Show last status:** what Kakitori is doing right now, or how the last transcription ended.

## Good to know

- **Your video file is changed in place.** Kakitori adds one subtitle track and keeps everything else: picture, all audio tracks, existing subtitles, title and modified date. Before writing anything, it checks that the new file is complete. Two things can be lost:
  - **macOS:** Finder tags, Finder comments and the file's creation date.
  - **Some iPhone videos:** extra camera data that can't be copied. When that happens, the popup tells you.
- **Each video is transcribed once.** If a video already has Kakitori's Japanese track, Kakitori tells you instead of transcribing it again, so you're never charged twice.
- **Only the audio is uploaded** to ElevenLabs, never the picture. See [ElevenLabs' privacy policy](https://elevenlabs.io/privacy-policy).
- **Your API key is stored in plain text** in `config.json` in Kakitori's folder (see [Where things live](#where-things-live)). On macOS only your user account can read it.
- **Timeouts:** if ElevenLabs takes more than 15 minutes, Kakitori stops and doesn't retry. ElevenLabs may still finish, and charge for, that attempt.
- **Local drives only:** iCloud Drive, network shares and exFAT external drives aren't supported yet.

## If something goes wrong

### Kakitori isn't in VLC's menu

Quit VLC completely and open it again. If it's still missing, run the install command again.

### "Kakitori didn't start"

Kakitori's programs aren't signed by Apple or Microsoft, so your system may block them.

- **macOS:** open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to `kakitori`.
- **Windows:** SmartScreen or your antivirus may have blocked `kakitori.exe`. Allow it (it's in `%APPDATA%\vlc\kakitori\bin`) and try again.

### The video is open in VLC (Windows)

Windows doesn't let Kakitori replace a video that VLC has open. Kakitori waits up to 2 minutes for you to close it. If it's still open, Kakitori keeps the finished file next to your video, as `<name>.kakitori.tmp.<ext>`, and asks you to close the video and choose it again. Do that, and Kakitori puts the finished file in place **without contacting ElevenLabs again**. If you never come back for it, you can delete that file.

### Messages

| Message | What to do |
| --- | --- |
| API key rejected. Use Change API key. | Paste a valid key with **Change API key**. |
| No API key saved. Use Change API key. | Save your key with **Change API key**. |
| *ElevenLabs' own text about credits or limits* | Check your ElevenLabs plan. |
| Couldn't reach ElevenLabs. Check your internet connection. | Kakitori already retried 3 times. Try again later. |
| ElevenLabs had a problem. Try again later. | ElevenLabs failed 4 times in a row. Try again later. |
| ElevenLabs took too long. Try again later. | No answer within 15 minutes. That attempt may still be billed. |
| ElevenLabs can't transcribe videos longer than 10 hours. | Split the video. Nothing was uploaded. |
| The audio is larger than ElevenLabs' 3 GB upload limit. | Split the video. Nothing was uploaded. |
| No audio track found. | The video has no sound to transcribe. |
| Subtitles can't be added to this file type. | Only MP4, M4V and MOV are supported. |
| The video file can't be found. | It was moved, renamed or deleted. Choose it again. |
| Not enough free space next to the Video. | Kakitori needs free space as large as the video while it works. |
| Couldn't add the subtitles to this file. | Your video is untouched. Details are in `log.txt`. |
| Something went wrong. See the log for details. | Your video is untouched. Details are in `log.txt`. |
| A transcription is already running. | Wait for it to finish. |
| Kakitori is still starting the last transcription. … | Wait a few seconds and try again. |
| Close the video in VLC, then choose it again in Kakitori. | See [The video is open in VLC](#the-video-is-open-in-vlc-windows). |
| Kakitori didn't start. … | See ["Kakitori didn't start"](#kakitori-didnt-start). |

## Where things live

| | macOS | Windows |
| --- | --- | --- |
| Extension | `~/Library/Application Support/org.videolan.vlc/lua/extensions/kakitori.lua` | `%APPDATA%\vlc\lua\extensions\kakitori.lua` |
| Kakitori's folder | `~/Library/Application Support/org.videolan.vlc/kakitori/` | `%APPDATA%\vlc\kakitori\` |

Kakitori's folder holds:

- `config.json`: your API key
- `status.json`: the last status
- `log.txt`: a log of every transcription, which never contains your key
- `bin/`: the programs

## Uninstall

**macOS:**

```sh
curl -fsSL https://github.com/Ayzora/kakitori-vlc/releases/latest/download/uninstall.sh | sh
```

**Windows:**

```powershell
irm https://github.com/Ayzora/kakitori-vlc/releases/latest/download/uninstall.ps1 | iex
```

This stops any running transcription, then removes the extension and Kakitori's folder, including your saved API key. Subtitle tracks already added to your videos stay in them.

## For developers

The core program is TypeScript, run and compiled with [Bun](https://bun.com). The extension is Lua for VLC 3.

```sh
cd core
bun install
bun run fetch-ffmpeg        # static ffmpeg + ffprobe for the tests, into core/vendor
bun test
bun check                   # type check
bun run build               # compiled program in core/dist
bun src/index.ts video.mp4  # transcribe one video from a terminal, without the picker
```

- **Test the installer with a local build:** set `KAKITORI_BASE_URL` to a `file://` folder that holds the platform zip and `SHA256SUMS.txt`.
- **Release:** push a tag such as `v1.0.0`. GitHub Actions tests on macOS and Windows, builds all three platforms, and publishes the release (`.github/workflows/release.yml`).
- **Design notes:**
  - `CONTEXT.md`: the words we use
  - `docs/adr/`: decisions and why
  - `.scratch/kakitori-vlc-v1/spec.md`: the spec
  - `docs/design-spec-v1.md`: the original design

## License

MIT, see [LICENSE](LICENSE). Kakitori bundles ffmpeg (GPL); see [THIRD_PARTY.md](THIRD_PARTY.md).
