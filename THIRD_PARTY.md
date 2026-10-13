# Third-party software

## FFmpeg

Each release bundles unmodified static builds of `ffmpeg` and `ffprobe` from the [FFmpeg](https://ffmpeg.org) project, version 9.0.2 (Linux: the 9.0 release branch just after 9.0.2). Kakitori runs them as separate programs; it doesn't link against them.

These builds are configured with `--enable-gpl --enable-version3`, so they are licensed under the **GNU General Public License, version 3 or later**. The full license text is at <https://www.gnu.org/licenses/gpl-3.0.txt>, and FFmpeg's licensing notes are at <https://ffmpeg.org/legal.html>.

Source code:

- FFmpeg 9.0.2 source: <https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz>
- macOS builds: <https://ffmpeg.martin-riedl.de> (build scripts: <https://git.martin-riedl.de/ffmpeg/build-script>)
- Windows build: <https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2> (by <https://www.gyan.dev/ffmpeg/builds/>)
- Linux build: <https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-30-13-08>, made from FFmpeg's `release/9.0` branch at commit [`2a571b6068`](https://github.com/FFmpeg/FFmpeg/commit/2a571b6068), 17 commits after 9.0.2 (build scripts: <https://github.com/BtbN/FFmpeg-Builds>)

The exact archives and their SHA-256 checksums are pinned in `core/scripts/fetch-ffmpeg.ts`.

## BudouX

The Kakitori core includes [BudouX](https://github.com/google/budoux) (Apache License 2.0), compiled into the `kakitori` program. BudouX splits Japanese text into natural phrases.
