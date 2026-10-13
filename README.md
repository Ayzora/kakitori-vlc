# Kakitori for VLC

Japanese subtitles for your own Japanese videos, made from inside VLC.

Play a video, click Start and keep watching. Kakitori sends the audio to [ElevenLabs](https://elevenlabs.io) Scribe v2 and adds the result as a subtitle track inside the same video file, so the subtitles go wherever the file goes. They work in VLC, QuickTime, the Apple TV app and Films & TV.

Works with VLC 3.0.x on macOS (Apple Silicon and Intel), Windows x64 and Ubuntu x64, for MP4, M4V and MOV files on your own drive. On Ubuntu, VLC must be installed with `sudo apt install vlc`; the Snap and Flatpak versions aren't supported.

## What you need

- [VLC 3.0.x](https://www.videolan.org/vlc/)
- An [ElevenLabs API key](https://elevenlabs.io/app/settings/api-keys). Transcriptions are billed to your ElevenLabs account.

## Install

On macOS, paste this into Terminal:

```sh
curl -fsSL https://github.com/Ayzora/kakitori-vlc/releases/latest/download/install.sh | sh
```

On Windows, paste this into PowerShell:

```powershell
irm https://github.com/Ayzora/kakitori-vlc/releases/latest/download/install.ps1 | iex
```

On Ubuntu, paste this into Terminal:

```sh
wget -qO- https://github.com/Ayzora/kakitori-vlc/releases/latest/download/install.sh | sh
```

When it prints "Done", quit VLC completely and open it again. Run the same command later to upgrade; your saved key is kept.

The installer checks the download against the release's checksums before installing anything. On macOS it also clears the "downloaded from the internet" flag so Gatekeeper doesn't block Kakitori.

## Using it

1. Play your video in VLC.
2. Open Kakitori from VLC's menu: VLC > Extensions > Kakitori on macOS, View > Kakitori on Windows and Ubuntu.
3. Click Transcribe this video. The first time, paste your ElevenLabs key and click Save.
4. Check the name and length, then click Start.
5. Keep watching. You'll get a notification when it's done, usually within a minute or two.
6. Open Kakitori again and click Reload video. The video picks up where you were, with Japanese subtitles on.

If a video already has Japanese subtitles, the button changes to Transcribe again. It replaces Kakitori's subtitles with a new transcription, which is billed again. Other subtitle tracks are kept.

On macOS the notification comes from Script Editor, which Kakitori uses to show it. Allow it if macOS asks. Its Show button just opens Script Editor, so you can ignore it.

On Windows, VLC locks the video while it plays, so Kakitori can't add the subtitles straight away. The window says "Ready to reload" instead, and Reload video stops the video, adds them and reopens it. Nothing is charged twice.

## Good to know

- Kakitori changes your video file in place. It keeps the picture, every audio and subtitle track, the title and the modified date, and checks the new file is complete before replacing the old one. On macOS, Finder tags, comments and the creation date are lost. Some iPhone videos also lose extra camera data, and Kakitori tells you when that happens.
- Only the audio is uploaded to ElevenLabs, never the picture. See their [privacy policy](https://elevenlabs.io/privacy-policy).
- Your key is saved in plain text in Kakitori's folder. On macOS and Ubuntu only your user account can read it.
- If ElevenLabs takes longer than 15 minutes, Kakitori gives up. That attempt may still be billed.
- iCloud Drive, network shares and exFAT drives aren't supported yet.
- If you move or rename the video while it's being transcribed, the transcription fails and the attempt is still billed. Open it from its new place and try again.

## Uninstall

macOS:

```sh
curl -fsSL https://github.com/Ayzora/kakitori-vlc/releases/latest/download/uninstall.sh | sh
```

Windows:

```powershell
irm https://github.com/Ayzora/kakitori-vlc/releases/latest/download/uninstall.ps1 | iex
```

Ubuntu:

```sh
wget -qO- https://github.com/Ayzora/kakitori-vlc/releases/latest/download/uninstall.sh | sh
```

This removes the extension and Kakitori's folder, including your key. Subtitles already added to your videos stay.

## Development

The core is TypeScript built with [Bun](https://bun.com). The extension is Lua for VLC 3.

```sh
cd core
bun install
bun run fetch-ffmpeg        # ffmpeg and ffprobe for the tests
bun test
bun check                   # type check
bun run build               # compiled program in core/dist
bun src/index.ts video.mp4  # transcribe a video from the terminal
```

The extension only starts the work and reopens the video. It writes a request into `job.json` in Kakitori's folder and starts the core, which does the rest and reports progress in `status.json`. No file path or key ever goes on a command line.

To test the installer with a local build, set `KAKITORI_BASE_URL` to a `file://` folder holding the platform zip and `SHA256SUMS.txt`. Pushing a tag such as `v1.1.0` runs the tests, builds all four platforms and publishes a release.

## License

MIT, see [LICENSE](LICENSE). Kakitori bundles ffmpeg, which is GPL; see [THIRD_PARTY.md](THIRD_PARTY.md).
