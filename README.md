# Kakitori for VLC

**Japanese subtitles for your own Japanese videos, made from inside VLC.**

Play a video, click **Start**, and keep watching. Kakitori sends the video's audio to [ElevenLabs](https://elevenlabs.io) Scribe v2, turns the result into readable Japanese subtitles, and adds them as a subtitle track **inside the same video file**. When it's done, a notification tells you, and one click reopens the video where you were, with the subtitles on.

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

1. Open your video in VLC and start watching.
2. Open the Kakitori window:
   - **macOS:** **VLC → Extensions → Kakitori**
   - **Windows:** **View → Kakitori**
3. Click **Transcribe this video**.
4. **First time only:** paste your ElevenLabs API key and click **Save**.
5. Kakitori asks **"Transcribe <name> (length)?"**. Click **Start**.
6. Keep watching. Kakitori works in the background, usually for a minute or two. When it's done, a notification says so.
7. Open the Kakitori window again and click **Reload video**. The video reopens where you were, with the Japanese subtitles on.

**macOS:** the notification comes from **Script Editor**, the Mac's built-in tool Kakitori uses to show it. The first time, macOS may ask whether Script Editor can send notifications; allow it to see them. Its **Show** button only opens Script Editor, so you can ignore it. Either way, the Kakitori window always shows how it's going.

**Windows:** Windows doesn't let Kakitori change a video while VLC is playing it. When the window says **Ready to reload**, click **Reload video**: Kakitori stops the video, adds the subtitles, and reopens it where you were.

The Kakitori window shows how the transcription of the video you're watching is going or how it ended. It also has **Change API key**, to paste a new key, for example after "API key rejected".

## Good to know

- **Your video file is changed in place.** Kakitori adds one subtitle track and keeps everything else: picture, all audio tracks, existing subtitles, title and modified date. Before writing anything, it checks that the new file is complete. Two things can be lost:
  - **macOS:** Finder tags, Finder comments and the file's creation date.
  - **Some iPhone videos:** extra camera data that can't be copied. When that happens, the notification and the Kakitori window tell you.
- **Transcribe again:** when a video already has Japanese subtitles, the Kakitori window says so and the button becomes **Transcribe again**. It asks first, because the audio is uploaded and billed again, then replaces Kakitori's Japanese track with the new one. Other subtitle tracks stay.
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

Windows doesn't let Kakitori replace a video that VLC has open. So Kakitori keeps the finished file next to your video, as `<name>.kakitori.tmp.<ext>`, and the window says **Ready to reload**. Click **Reload video**, and Kakitori stops the video and puts the finished file in place **without contacting ElevenLabs again**. If you never come back for it, you can delete that file.

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
| The video file can't be found. | It was moved, renamed or deleted. Open it again in VLC. |
| Not enough free space next to the video. | Kakitori needs free space as large as the video while it works. |
| Couldn't add the subtitles to this file. | Your video is untouched. Details are in `log.txt`. |
| Something went wrong. See the log for details. | Your video is untouched. Details are in `log.txt`. |
| Japanese subtitles are already in … | The video already has Kakitori's subtitles. Use **Transcribe again** to replace them. |
| A transcription is already running. | Wait for its notification, then try again. |
| Kakitori is still starting the last transcription. … | Wait a few seconds and try again. |
| Kakitori isn't fully installed. Run the install command again. | Run the install command again. |
| The subtitles are ready. Click Reload video to add them. | See [The video is open in VLC](#the-video-is-open-in-vlc-windows). |
| Open a video in VLC first, then click Transcribe this video. | Start playing the video you want transcribed. |
| Kakitori can only transcribe a video file on this computer. | Streams and discs aren't supported. |
| Kakitori is still adding the subtitles. … | Wait a moment, then click **Reload video** again. |
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
bun src/index.ts video.mp4  # transcribe one video from a terminal
```

- **Test the installer with a local build:** set `KAKITORI_BASE_URL` to a `file://` folder that holds the platform zip and `SHA256SUMS.txt`.
- **Release:** push a tag such as `v1.0.0`. GitHub Actions tests on macOS and Windows, builds all three platforms, and publishes the release (`.github/workflows/release.yml`).
- **How it fits together:** the extension (`extension/kakitori.lua`) only starts work and reopens the video. It writes the request into `job.json` in Kakitori's folder and starts the core (`core/`) with no arguments, so no path or key ever goes on a command line. The core does the rest (ffprobe, audio extraction, ElevenLabs, building the subtitles, the checked copy and swap), reports every stage in `status.json`, which the Kakitori window shows, and ends with a notification.

## License

MIT, see [LICENSE](LICENSE). Kakitori bundles ffmpeg (GPL); see [THIRD_PARTY.md](THIRD_PARTY.md).
