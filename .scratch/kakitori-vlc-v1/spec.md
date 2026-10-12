# Kakitori VLC extension v1

Status: ready-for-agent

## Problem Statement

People who watch Japanese videos in VLC, often learners, have no Japanese subtitles for most of their own clips: phone recordings, lessons, home video. Getting them today means leaving VLC, running a separate tool, and juggling a loose `.srt` file. VLC only loads that file when it sits next to the video with the same name. It breaks when the video is moved, renamed or shared, and QuickTime, the Apple TV app and Films & TV don't show it. Setting up such a tool (a runtime, ffmpeg, an API key in an env file) is beyond most viewers.

## Solution

A VLC 3 extension, installed with one command on Windows or macOS. The user adds a Video to VLC's playlist, clicks View → Kakitori → Transcribe (macOS: VLC → Extensions → Kakitori → Transcribe), confirms the file name and length, and keeps using VLC.

In the background, Kakitori does four things:

1. It sends only the Video's audio to ElevenLabs Scribe v2, using the user's own API key.
2. It builds Japanese subtitles from the word timings.
3. It adds them as a Subtitle track inside the same Video.
4. It shows a system popup when the Subtitle track is in, or explains why it failed.

The user reopens the Video and picks the Japanese track under Subtitle → Sub Track. The same file also shows the subtitles in QuickTime, the Apple TV app and Films & TV.

## User Stories

### Install, upgrade, uninstall

1. As a Windows user, I want to install Kakitori with one PowerShell command, so that I don't have to copy files into hidden folders myself.
2. As a Mac user, I want to install Kakitori with one Terminal command, so that setup takes a minute.
3. As a user on an unsupported system (Linux, Windows on ARM, 32-bit Windows), I want the installer to print "Not supported" and stop, so that I don't end up with a half-installed tool.
4. As a user, I want the installer to check the download against the release's checksums and stop on a mismatch, so that a corrupted download is never installed.
5. As a user, I want the installer to create the VLC extensions folder if it's missing, so that a fresh VLC install works.
6. As a Mac user, I want the installer to make the programs runnable and clear their quarantine flag, so that Gatekeeper doesn't block Kakitori the first time it runs.
7. As a user, I want the installer to end with the exact next step ("Done. Restart VLC, then View → Kakitori → Transcribe."), so that I know where to find the menu.
8. As a returning user, I want re-running the install command to upgrade Kakitori in place, so that updating is the same one command.
9. As a returning user, I want my saved API key to survive an upgrade, so that I don't have to paste it again.
10. As a user, I want a one-line uninstall command that stops any running Transcription and removes the extension, the programs, my saved key, the status and the log, so that nothing of Kakitori is left on my machine.
11. As a user, I want Subtitle tracks already added to my Videos to stay after uninstalling, so that I keep what I paid for.

### API key

12. As a first-time user, I want Transcribe to ask for my ElevenLabs API key when none is saved and then go straight on to the confirmation, so that setup happens in the normal flow.
13. As a user, I want the key field masked, so that someone looking at my screen can't read it.
14. As a user, I want an empty key to be refused with an inline message and nothing saved, so that I don't save a blank key by mistake.
15. As a user, I want a "Change API key" menu item, so that I can replace a rejected or rotated key.
16. As a Mac user, I want the saved key file readable only by my account, so that other accounts on the machine can't read it.
17. As a user, I want my key never to appear in a log, a command line or the process list, so that it can't leak through shared logs or screenshots.
18. As a user, I want the README to tell me the key is stored in plain text, so that I can decide whether that's acceptable.
19. As a developer, I want an `ELEVENLABS_API_KEY` environment variable to override the saved key, so that I can test without touching my real setup.

### Choosing the Video

20. As a user, I want Kakitori to pick the most recently added MP4, M4V or MOV in the playlist, so that I don't have to play the Video first. A Lua extension can't read which item is highlighted.
21. As a user, I want newer playlist items of other types (MKV, AVI, streams) skipped, so that I'm not offered a file that can't work.
22. As a user, I want "Add an MP4, M4V or MOV video to the playlist first." when nothing matches, so that I know what to do.
23. As a user, I want to confirm the file name and length before anything is uploaded, so that I'm never billed for the wrong Video.
24. As a user, I want the dialog to say "(length unknown)" when VLC hasn't read the length yet, so that confirming still works for Videos I've never played.
25. As a user, I want Cancel to do nothing at all, so that backing out is always safe.
26. As a user, I want VLC to stay responsive and show "Transcribing…" right after I click Start, so that I can keep watching while Kakitori works.
27. As a user, I want Kakitori to keep working if I quit VLC partway through, so that closing VLC doesn't waste a paid Transcription.
28. As a user with Japanese file and folder names, I want everything to work with them, so that I don't have to rename my files.

### The Transcription

29. As a user, I want only the Video's audio uploaded, copied without re-encoding when possible, so that long or 4K Videos start quickly and uploads stay small.
30. As a user with a MOV that has uncompressed audio, I want Kakitori to fall back to compact re-encoded audio, so that the Transcription still works.
31. As a user whose Video has several audio tracks, I want the first Japanese-tagged track used (or the first track if none is tagged), so that an English dub isn't sent to a Japanese transcriber.
32. As a user, I want subtitles split into natural Japanese phrases and sentences, with readable line lengths and comfortable timing, exactly as the existing Kakitori tool produces them, so that they are easy to read.
33. As a user, I want the Subtitle track inside the same Video and labelled "Japanese", so that I can pick it in VLC and it travels with the file.
34. As a user, I want the same Video to show the subtitles in QuickTime, the Apple TV app and Films & TV, so that I'm not tied to VLC.
35. As a user, I want no `.srt` or other files left next to my Video after a normal Transcription, so that my folders stay clean.
36. As a user, I want every other stream in my Video (video, all audio tracks, existing subtitles and captions) kept exactly as it was, so that adding subtitles takes nothing away.
37. As an iPhone user, I want the Transcription to still succeed when camera data tracks can't be copied, with the popup adding "Some extra camera data was removed.", so that I know what changed.
38. As a user, I want my Video's modified date (and on macOS its permissions) kept, so that sorting my folders by date doesn't change.
39. As a user, I want my Video left untouched whenever anything fails, so that a failed Transcription can never damage it.
40. As a user, I want a Video that already has a Kakitori Subtitle track never transcribed again, and told "Japanese subtitles are already in \<name\>", so that I'm never charged twice.
41. As a user, I want a system popup "Japanese subtitles added to \<name\>" when it's done, with Japanese names shown correctly, so that I know without watching VLC.
42. As a user, I want "Show last status" to show the current stage (extracting, transcribing, muxing, waiting for the Video to close, done or error), the file, and the message, so that I can check progress at any time.
43. As a user who is away from the computer, I want the popup to be the very last step, so that the status is already final and a new Transcription can start even if nobody has clicked OK.

### Locked Video (Windows)

44. As a Windows user who left the Video playing, I want Kakitori to keep trying to replace it for 2 minutes, so that briefly closing it is enough.
45. As that user, I want Kakitori to keep the finished copy as a Pending copy and tell me "Close the video in VLC, then click Transcribe again." if the Video stays locked, so that the paid work isn't lost.
46. As that user, I want my next Transcription of that Video to use the Pending copy without contacting ElevenLabs, even if I transcribed other Videos in between, so that I'm not charged again.
47. As a user who changed the Video after a Pending copy was made, I want the stale Pending copy thrown away and a fresh Transcription done, so that I never get subtitles for an old version.

### Failures

48. As a user with a rejected key, I want "API key rejected. Use Change API key.", so that I know how to fix it.
49. As a user who is out of credits or rate-limited, I want ElevenLabs' own error text and no retry, so that I see the real reason and nothing is retried that can't succeed.
50. As a user on a flaky connection, I want connection failures and ElevenLabs server errors retried up to 3 times (after 2, 4 and 8 seconds), so that a short glitch doesn't fail the Transcription.
51. As a user whose Transcription takes over 15 minutes at ElevenLabs, I want "ElevenLabs took too long. Try again later." and no automatic retry, so that I'm not billed twice for the same audio.
52. As a user, I want "No audio track found." for a Video without audio, so that I know why nothing happened.
53. As a CLI user, I want "Subtitles can't be added to this file type." for anything that isn't MP4, M4V or MOV, so that I'm not left guessing.
54. As a user with a very long or very large Video, I want to be told ElevenLabs' limit before any upload, so that I'm not billed for a request that will fail.
55. As a user, I want a clear message when the Video's folder doesn't have enough free space for the working copy, so that I can free some up.
56. As a user who clicks Transcribe again while one is running, I want "A transcription is already running." and the running Transcription's status left alone, so that "Show last status" stays correct.
57. As a user whose computer crashed mid-Transcription, I want the leftover "already running" marker ignored once its process is gone, so that I'm never permanently blocked.
58. As a user whose antivirus, SmartScreen or Gatekeeper silently blocked Kakitori, I want "Kakitori didn't start. Your antivirus or macOS security may have blocked it. See the README." on my next Transcribe or Show last status, so that I'm not left waiting forever.
59. As a user whose popup failed to appear, I want the result still available in Show last status, so that I can find out what happened.

### Developer and maintainer

60. As a developer, I want to run the core as `kakitori <video>` from a terminal, so that I can test it without VLC.
61. As a developer, I want a second, accidental launch with no work waiting to exit silently, so that double launches are harmless.
62. As a maintainer, I want an append-only log with the details of every run (never the key), so that I can debug user reports.
63. As a maintainer, I want a tag push to build all three targets with ffmpeg and ffprobe bundled, then attach per-platform zips, checksums, and the install/uninstall scripts to the GitHub Release, so that "latest" always points to the newest version.
64. As a maintainer, I want ffmpeg's license and source link shipped with every release, so that bundling it is compliant.
65. As a user, I want the README to cover:
    - install and uninstall;
    - that usage is billed to my own ElevenLabs account and that my audio is uploaded (with a link to ElevenLabs' privacy policy);
    - plain-text key storage;
    - Gatekeeper, SmartScreen and antivirus warnings;
    - local drives only (not iCloud Drive, network shares or exFAT);
    - what happens to my Video: it is rewritten in place; the modified date is kept; Finder tags, comments and the creation date are lost on macOS; camera data may be dropped; it is never transcribed twice; a Pending copy may be left next to it; a timed-out attempt may still be billed.

  This way I know exactly what I'm agreeing to.

## Implementation Decisions

### Architecture (see ADR 0001 and ADR 0002)

- Four parts:
  - **The Lua extension:** a VLC 3.0.x extension with menu capability. It only starts work.
  - **The core:** the existing TypeScript transcription logic, compiled with Bun into one program per platform (Windows x64, macOS arm64, macOS x64). It does everything else.
  - **ffmpeg and ffprobe:** bundled static builds.
  - **The OS popup:** osascript on macOS, PowerShell on Windows.
- **The Subtitle track goes inside the Video, not into a `.srt` sidecar file** (ADR 0001). Only MP4, M4V and MOV are supported, and the container is kept.
- **The extension and the core talk only through files in the state folder** (ADR 0002). The extension writes the Transcription request to `job.json` and starts the core with **no arguments**, detached. Nothing goes on a command line, which keeps Japanese paths from being mangled on Windows and keeps the key out of the process list. The extension never makes network calls and never waits on the core.
- **State folder:** `kakitori` inside VLC's user data directory. Programs go in its `bin` subfolder. The core finds the state folder relative to its own location.

### File contracts in the state folder

- `config.json`, written by the extension: `{ apiKey }`. On macOS the extension makes it readable only by its owner right after writing.
- `job.json`, written by the extension in UTF-8: `{ id, inputPath, createdAt }`. `createdAt` is in Unix seconds so Lua can compare it with its own clock. The core deletes it as soon as it has read it.
- `status.json`, written only by the core: `{ id, state, inputPath, message, updatedAt }`.
  - `state` is one of `extracting`, `transcribing`, `muxing`, `waiting-for-unlock`, `done`, `error`.
  - The core writes it at every stage change.
  - The rejected second Transcription never writes it.
  - No record of a Pending copy is ever stored here.
- A lock file holding the running core's process ID. A lock whose process is gone counts as stale and is removed.
- An append-only log that never contains the key.

### Lua extension

- **Menu:** Transcribe · Change API key · Show last status. Activating the extension does nothing by itself; the menu items do the work. Deactivating or closing it closes any open dialog.
- **Key dialog:** a masked field and a Save button. An empty value shows an inline error and saves nothing. Clicking Transcribe with no key saved opens this dialog first, then goes on to the confirmation after Save.
- **Picking the target:** the most recently added playlist item that is a local file ending in `.mp4`, `.m4v` or `.mov` (any letter case). Items of any other type are skipped, even if newer. The item's address is turned into a file path with VLC's path helper.
- **Launch steps:**
  1. If a `job.json` older than 60 seconds is still there, the core never started. Delete it, show the "didn't start" message, and stop.
  2. Show the confirmation "Transcribe \<name\> (\<duration\>)?", with "(length unknown)" as the fallback, and the buttons Start and Cancel.
  3. On Start, write `job.json`, start the core detached (Windows: `start "" /b`; macOS: in the background with its output discarded), show the on-screen message "Transcribing…", and return at once.
- **Show last status:** show the "didn't start" message if a `job.json` older than 60 seconds is still there. Otherwise show state, file and message from `status.json`.

### Core: modules

The core is organised around one top-level **Transcription runner**. It takes a Transcription request (id and Video path) and the outside world it needs:

- an ElevenLabs client;
- a popup;
- a way to wait (used for retry backoff and the lock retry);
- the state folder;
- where ffmpeg and ffprobe live.

It returns the outcome: done, already subtitled, or error with its message. The program entry point only builds the real outside world and hands either `job.json` or a CLI path to the runner. A run with no arguments and no `job.json` exits silently.

Modules behind the runner:

- **Config:** loads the key. `ELEVENLABS_API_KEY` overrides the saved key.
- **Video inspection (ffprobe):**
  - lists streams with their codecs;
  - picks the audio stream: the first one tagged `jpn`, otherwise the first one;
  - reads the duration;
  - recognises a Kakitori Subtitle track: a `jpn` subtitle stream labelled `Japanese`.
- **Audio extraction:** copies the chosen audio stream into a temporary `.m4a` in the OS temp folder without re-encoding. If that fails, it re-encodes as mono AAC at 64 kbps.
- **ElevenLabs client:** reuses the existing script's request code.
  - **Request:** model `scribe_v2`; language `jpn`; word timestamps; no speaker labels; no audio-event tags; a 15-minute timeout. The key comes from Config, not the old `SCRIBE_V2` variable.
  - **Error mapping:**
    - 401 → "API key rejected. Use Change API key."
    - 402 or 429 → ElevenLabs' own error text, no retry.
    - Connection failure or 5xx → retry up to 3 times after 2, 4 and 8 seconds.
    - Timeout → "ElevenLabs took too long. Try again later.", never retried.
  - Checks ElevenLabs' size and duration limits before uploading.
- **Cue builder:** ported unchanged from the existing Kakitori web app, including BudouX phrasing, sentence splits, line wrapping, timing pad and all of its constants. It turns word timings into SRT text, written to the OS temp folder. Don't re-tune it in v1.
- **Muxer:** writes a working copy, `<name>.kakitori.tmp.<ext>`, in the Video's folder.
  - It maps everything from the Video plus the SRT and copies all streams.
  - Only the new subtitle stream is encoded as `mov_text`; existing subtitle and caption streams are never re-encoded.
  - The new stream gets language `jpn` and handler name `Japanese`; that label is also the mark of an already subtitled Video. (Settled during implementation: the planned file-level `kakitori=1` tag needed ffmpeg's metadata-tags option, which hid the title from Apple's players, so it was dropped.)
  - The Video's container, brand and recording date (`creation_time`, which ffmpeg drops by default) are kept.
  - If the mux fails, it retries once with data streams dropped, and the outcome records that camera data was removed.
- **Check:** with ffprobe, the working copy must have every stream of the Video with the same codec, plus exactly one new subtitle stream, and a duration within 1 second of the Video's. Only after a data-stream-dropping retry may data streams be missing.
- **Swap:**
  - Renames the working copy over the Video. After the rename, it puts back the Video's earlier modified time and, on macOS, its permissions.
  - If the Video is locked, status becomes `waiting-for-unlock` and the rename is retried every 5 seconds for 2 minutes. After that, the working copy stays as a **Pending copy** and the Transcription ends with "Close the video in VLC, then click Transcribe again."
- **Pending copy detection** (during validation): if `<name>.kakitori.tmp.<ext>` exists next to the Video, it has the Subtitle track, it passes the Check against the Video, and it is newer than the Video, then go straight to the Swap with no ElevenLabs call. Otherwise delete it and transcribe normally.
- **Validation order:**
  1. The file exists.
  2. Its extension is supported.
  3. It has an audio stream.
  4. The folder has free space of at least the Video's size.
  5. A Subtitle track already there means already subtitled: no redo in v1.
  6. Pending copy detection.
- **Finish order:**
  1. Delete the SRT, the extracted audio, and the working copy (unless it was kept as a Pending copy).
  2. Write the final status.
  3. Release the lock.
  4. Last of all, show the popup. Wait for it only to log a failure to show.
- **Popup:** macOS uses osascript's display dialog. Windows uses a PowerShell message box passed with `-EncodedCommand` so that Japanese names survive.
- **Windows build:** compiled with Bun's hide-console option so no window flashes.

### User messages

| Situation | Message |
| --- | --- |
| Success | "Japanese subtitles added to \<name\>" (plus "Some extra camera data was removed." if data streams were dropped) |
| Already subtitled | "Japanese subtitles are already in \<name\>" |
| Locked after 2 minutes | "Close the video in VLC, then click Transcribe again." |
| Bad key | "API key rejected. Use Change API key." |
| Quota or rate limit | ElevenLabs' own text |
| Timeout | "ElevenLabs took too long. Try again later." |
| No audio | "No audio track found." |
| Unsupported type | "Subtitles can't be added to this file type." |
| Over ElevenLabs limit | States the limit |
| Not enough space | "Not enough free space next to the Video." |
| Already running | "A transcription is already running." |
| Core never started (Lua) | "Kakitori didn't start. Your antivirus or macOS security may have blocked it. See the README." |
| No target (Lua) | "Add an MP4, M4V or MOV video to the playlist first." |

### Installer, uninstaller, release

- **Install scripts** (PowerShell for Windows, sh for macOS):
  1. Detect OS and CPU.
  2. Download the matching zip from the same release and check it against `SHA256SUMS.txt`.
  3. Copy the extension into VLC's extensions folder.
  4. Copy the programs into the state folder's `bin` subfolder (macOS: make them runnable and clear the quarantine flag).
  5. Never touch `config.json`.
  6. Print the next step.
- **Uninstall scripts:** stop any running core, delete the extension and the whole state folder, then print "Uninstalled. Restart VLC."
- **Release:** a GitHub Actions workflow runs on tag push.
  - It builds the three targets and fetches static ffmpeg and ffprobe for each.
  - It attaches one zip per platform (extension, bin, README), plus the four scripts and `SHA256SUMS.txt` as separate files, so "latest" download links always work.
  - Project licence: MIT. The ffmpeg licence and a source link go in the third-party notice.

## Testing Decisions

- **What a good test is:** it drives the system the way a user or the extension would and checks only what can be seen from outside. That means:
  - the Video's streams and tags, read back with ffprobe;
  - the Subtitle track's text and timings, read back out of the Video;
  - `status.json`;
  - the popup text;
  - the files left next to the Video;
  - how many times ElevenLabs was called (calls cost money, so this is visible behaviour).

  Tests never check internal function calls or intermediate files.
- **One seam: the Transcription runner.** Tests call it in-process with a real sample Video and the real ffmpeg and ffprobe. The rest of its outside world is replaced:
  - **ElevenLabs:** a fake client returning canned word timings or canned failures (401, 402/429, 5xx, connection error, timeout).
  - **Popup:** a recorder that keeps the message instead of showing it.
  - **Waiting:** instant, so retry backoff and the 2-minute lock retry don't slow tests.
  - **State folder:** a temporary folder.
- **The cue builder is tested through the runner,** by feeding canned word timings and reading the Subtitle track back. It gets no seam of its own.
- **Scenarios to cover through the runner:**
  - **Success:** MP4 with a Japanese file name; MOV; M4V.
  - **Audio:** MOV with uncompressed audio (re-encode fallback); Video with English as the first audio track and Japanese as the second.
  - **Streams kept:** Video that already has a subtitle stream (kept untouched); iPhone clip with data tracks (data-drop retry and popup note).
  - **Rejected inputs:** Video with no audio; MKV/AVI through the CLI; not enough free space; over ElevenLabs' limit.
  - **Already subtitled:** no ElevenLabs call.
  - **Pending copy:** a fresh one is used with no ElevenLabs call; a stale one (older than the Video) is deleted and a full Transcription runs.
  - **ElevenLabs failures:** each one maps to its message; retry counts are 3 for 5xx and connection errors and 0 for timeout and 402/429.
  - **Second run while locked:** "already running" popup, `status.json` unchanged. A stale lock is removed.
  - **Video kept safe:** after every failure the Video's bytes are unchanged, and no extra files are left next to it.
  - **File info:** modified time kept after a swap.
  - **Status file:** stages appear in order, and the final status and lock release happen before the popup.
  - **Key:** never appears in the log.
- **Windows file lock:** tested on a Windows runner by holding the Video open during the run. It covers `waiting-for-unlock`, the Pending copy being kept, and the next run reusing it. macOS allows replacing an open file, so it can't be tested there.
- **No automated tests for the Lua extension or the installers.** VLC 3 has no test harness for extensions. They are covered by the throwaway spikes, the manual end-to-end run against the compiled core, and a smoke test of the real one-line install from a GitHub release.
- **No separate test against the compiled program.** Build step 4 runs the compiled CLI by hand on real Windows and macOS machines.
- **Prior art:** none in this repo yet; the test folder is empty. Tests use `bun test`. Sample media lives with the tests.

## Out of Scope

- Right-click or file-explorer trigger; Linux; VLC 4.x.
- Other engines (e.g. Qwen3-ASR); languages other than Japanese; auto-detecting the language; translation.
- Burned-in subtitles; MKV or any container other than MP4, M4V and MOV; converting or re-encoding the Video.
- Attaching subtitles live to a Video that's already playing; auto-playing the finished Video.
- Re-transcribing a Video that already has a Kakitori Subtitle track.
- Keeping a `.srt` file.
- Cleaning up a Pending copy that nobody comes back for.
- Code signing and Apple notarization.
- Cost estimates; a queue of several Transcriptions; cancelling a running Transcription.
- Videos on iCloud Drive, network shares or exFAT drives.
- Re-tuning the cue builder's constants.

## Further Notes

- **Spikes come first.** Throwaway code before anything else, to confirm the assumptions in the design spec's "Verify before building" list:
  - **VLC playlist:** items come back in the order they were added; local paths are available; the masked-field dialog exists; activation happens before every menu click; a never-played item's length may be unknown.
  - **Windows:** Lua's `io.open` works with non-English paths; launching doesn't flash a console window or block VLC.
  - **Core survives a VLC quit.**
  - **Popups:** Japanese names show correctly; the macOS dialog appears in front.
  - **Mux:** the data-track retry works on iPhone clips; title, date and location still show in QuickTime, Photos and Windows after the mux.
  - **VLC labels:** VLC shows the track as "Japanese".
  - **Windows locks:** how the lock behaves on Windows.
  - **Windows Defender:** whether it flags the Bun-compiled program.

  If a spike fails, update the design first.
- **Build order:**
  1. Spikes.
  2. Core as a CLI.
  3. Core robustness: status, log, lock, retries, locked swap, the error cases, popup.
  4. Compile for all targets.
  5. Lua extension.
  6. Installer and uninstaller.
  7. Release workflow.
  8. README and third-party notice.
  9. Acceptance pass on a clean Windows 11 PC and an Apple Silicon Mac.
- **Done when:**
  - A fresh one-line install works on both systems, and re-running it upgrades without losing the key.
  - The first run asks for the key; later runs don't.
  - A queued Japanese MP4 with a Japanese name gains a selectable "Japanese" track in the same file, with nothing left next to it.
  - That file shows subtitles in QuickTime, the Apple TV app and Films & TV.
  - VLC stays responsive throughout.
  - A 60-minute Video finishes with no manual steps.
  - Every failure shows its stated message.
  - The key appears in no log, command line or process list.
- **Sources:** the full design spec ("Kakitori VLC Extension - Spec v1") sits at the repo root. Terms are defined in `CONTEXT.md`. ADR 0001 and ADR 0002 record the two big decisions.
- **Filled in while writing this spec; confirm or change:**
  - `createdAt` is in Unix seconds.
  - The "not enough free space" message wording.
