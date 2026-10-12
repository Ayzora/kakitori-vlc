# **Kakitori VLC Extension \- Spec v1**

## **Overview and scope**

Kakitori is a VLC extension that transcribes a queued Japanese-language video with ElevenLabs Scribe v2, adds the subtitles as a track inside the original file (MP4, M4V or MOV), and notifies the user when it's ready. Open source; each user supplies their own ElevenLabs API key.

**v1 scope**

| Area | v1 |
| :---- | :---- |
| Trigger | VLC Lua extension (menu item) |
| VLC version | 3.0.x |
| OS | Windows x64; macOS arm64 \+ x64 |
| Engine | ElevenLabs Scribe v2 only |
| Output | The original file, with a soft Japanese subtitle track (mov\_text) added in place; no .srt or extra file left behind |
| Language | Japanese only (language\_code jpn, fixed; no auto-detect) |
| Core | Existing TypeScript script, compiled to a single binary per platform with Bun |
| License | MIT |

**Non-goals for v1:** right-click/file-explorer trigger, Linux, VLC 4.x, other engines (e.g. Qwen3-ASR), languages other than Japanese, translation, burned-in subtitles, live attach to an already-playing file, MKV output, auto-playing the finished file, re-transcribing a Video that already has a Subtitle track.

Terms (Transcription, Video, Subtitle track, Pending copy) are defined in CONTEXT.md. Decision records are in docs/adr/.

## **User flow**

**First run**

1. User runs the one-line command from the README, then restarts VLC. Windows (PowerShell): irm https\://github.com/\<owner\>/kakitori-vlc/releases/latest/download/install.ps1 | iex. macOS (Terminal): curl \-fsSL https\://github.com/\<owner\>/kakitori-vlc/releases/latest/download/install.sh | sh.  
2. User clicks View → Kakitori → Transcribe (macOS: VLC → Extensions → Kakitori → Transcribe).  
3. Extension finds no saved key and shows a dialog with a masked API key field and Save.  
   

**Normal run**

1. User adds a video to the playlist without playing it (drag in, or Media → Open with Enqueue).  
2. User clicks View → Kakitori → Transcribe.  
3. Extension selects the target item, asks the user to confirm it (file name and duration), writes a job file, launches the core binary detached, and closes immediately.  
4. Core binary transcribes, builds the subtitles, and adds them as a track to the original file.  
5. Core binary shows a system popup: "Japanese subtitles added to \<name\>" (or the error message).  
6. User reopens the video in VLC and picks the Japanese track under Subtitle → Sub Track.

**Extension menu items:** Transcribe · Change API key · Show last status.

## **Architecture**

Four parts. The extension only triggers work; the core binary does everything else.

| Component | Language / form | Responsibility |
| :---- | :---- | :---- |
| kakitori.lua | VLC 3 Lua extension | Menu items, API key dialog, target selection, write job file, launch core detached, show status |
| kakitori | TypeScript → Bun single binary | Read job, extract audio, call Scribe v2, build SRT, mux into the original file, write status, notify user |
| ffmpeg | Bundled static binary | Audio extraction (stream copy), subtitle muxing; ffprobe for input checks and output verification |
| System popup | osascript (macOS) / PowerShell (Windows), built into the OS | Tells the user the file is ready, or shows the error |

**Data flow**

1. Lua → job file (job.json) → launches kakitori with no arguments; kakitori reads job.json from its own folder.  
2. kakitori → ffmpeg (extract audio) → ElevenLabs Scribe v2 (HTTPS) → SRT → ffmpeg (mux).  
3. kakitori → status.json at every stage change, read by Lua's Show last status item.  
4. kakitori → system popup, always the very last step. macOS: osascript display dialog. Windows: PowerShell message box, passed with \-EncodedCommand so Japanese file names survive.

Lua never makes outbound HTTP calls. VLC has no callback into the extension, so completion is signalled by the core's system popup and the status file.

## **Lua extension (kakitori.lua)**

Target the VLC 3.0.x Lua extension API only.

**Required functions**

* descriptor(): title "Kakitori", version, author, capabilities \= {"menu"}.  
* activate(): does nothing (VLC calls it before trigger\_menu). trigger\_menu(Transcribe) with no saved key opens the key dialog first, then shows the confirmation dialog after Save.  
* menu() returns {"Transcribe", "Change API key", "Show last status"}; trigger\_menu(id) dispatches.  
* deactivate() and close(): close any open dialog.

**API key dialog**

* vlc.dialog("Kakitori – Setup") with a label, add\_password() field, and Save button.  
* Save writes apiKey to config.json (see Config). Empty input → inline error label, no write.

**Target selection**

* Rule: the most recently added playlist item that is a local file ending in .mp4, .m4v or .mov (case-insensitive). Items with any other extension are skipped, even if newer.  
* Convert its URI to a path with vlc.strings.make\_path().  
* No match → dialog "Add an MP4, M4V or MOV video to the playlist first."  
* Lua cannot read the UI's highlighted item. This rule is the workaround.

**Launch**

* If a job.json is still there and its createdAt is more than 60 s old, the core never picked it up (see "Core never starts" in Error handling): delete it, show that error's message, and stop.  
* Show a confirmation dialog: "Transcribe \<name\> (\<duration\>)?" with Start and Cancel; duration comes from the playlist item, or "(length unknown)" when VLC doesn't know it yet. Cancel writes nothing. On Start, write job.json (UTF-8): { id, inputPath, createdAt }.  
* Launch the core binary with no arguments (see Platform specifics for exact commands).  
* Show vlc.osd.message("Transcribing…") and return immediately. Never block on the process.

**Show last status:** if a job.json older than 60 s is still there, show the "Core never starts" message. Otherwise read status.json and display state, file, and message in a dialog.

## **Core binary (kakitori)**

Reuse the existing TypeScript transcription script as the core; strip the Next.js/UI layer.

Invocation: kakitori with no arguments reads \<bin\>/../job.json and deletes it immediately after reading, so a re-run (e.g. a double-click) finds no job and exits silently. Also accept kakitori \<video\> for CLI use and testing.

**Pipeline**

1. Load config; ELEVENLABS\_API\_KEY env var overrides apiKey.  
2. Validate input: file exists, extension is .mp4/.m4v/.mov, has an audio stream (ffprobe), and the folder has free space of at least the file's size (needed for the temp copy). If the file already has a Kakitori Subtitle track (a jpn subtitle stream labelled Japanese; see Mux command), skip to step 7 (no redo in v1). If a Pending copy \<name\>.kakitori.tmp.\<ext\> exists next to the Video, it has that track, it passes the step 6 check against the Video, and its modified time is newer than the Video's, skip straight to the rename in step 6\. Otherwise delete it (it is stale or incomplete) and continue. The Pending copy file itself is the only record; nothing about it is stored in status.json. The Subtitle-track and Pending copy checks run before the free-space check, since a Pending copy swap needs no new space.  
3. Extract audio to a temp .m4a by stream copy (ffmpeg \-vn \-map 0:a:\<k\> \-c:a copy), with no re-encoding, so it takes seconds even for long or 4K files. \<k\> is the first audio stream tagged language jpn; if none is tagged jpn, the first audio stream. If the copy fails (e.g. PCM audio in MOV), fall back to re-encoding as mono AAC at 64 kbps.  
4. Call Scribe v2 (model\_id scribe\_v2) with the extracted audio file, using the existing script's request code with the key from step 1 instead of its SCRIBE\_V2 env var: language\_code jpn, timestamps\_granularity word, diarize false, tag\_audio\_events false; 15-minute request timeout. Retries follow the error table; a timeout is never retried.  
5. Build SRT from word timestamps using the existing script's cue builder, ported unchanged (see below).  
6. Mux into a temp file in the same folder (command below). Check it with ffprobe: every stream of the Video is still there with the same codec, plus exactly one new subtitle stream, and the duration is within 1 s of the Video's. If the mux fails, retry once adding \-map \-0:d? (drops data tracks, e.g. iPhone camera data); the check then allows only data streams to be missing, and the success popup adds "Some extra camera data was removed." Then rename it over the Video, and after the rename set the Video's modified time and (macOS) file permissions back to what they were before. Doing this after the rename keeps a Pending copy newer than its Video. If the Video is locked (Windows, e.g. the video is playing in VLC), set status to waiting-for-unlock and retry every 5 s for 2 minutes; if still locked, keep the checked temp file as a Pending copy and end with "Close the video in VLC, then click Transcribe again." The next run reuses it (no new charge). On any failure the Video is left untouched. The SRT is written to the OS temp folder (not next to the video).  
7. Clean up and report: delete the SRT and the extracted audio; delete the temp copy of the video unless it was kept as a Pending copy (step 6); write the final status.json (done or error); release the lock.  
8. Last, show the system popup: "Japanese subtitles added to \<name\>" on success; "Japanese subtitles are already in \<name\>" if step 2 found a Kakitori Subtitle track; the one-line error message on failure. Wait for the popup only to log a failure to show it; nothing else runs after it.

status.json is written at every stage change (extracting, transcribing, muxing, waiting-for-unlock, then done or error), not only at the end.

SRT cue builder: reuse srt logic from the existing script as-is (BudouX phrasing, sentence splits, timing pad). Its constants are the source of truth; don't re-tune in v1.

**Mux command**

ffmpeg \-i in.\<ext\> \-i subs.srt \-map 0 \-map 1 \-c copy \-c:s:\<n\> mov\_text \-metadata:s:s:\<n\> language=jpn \-metadata:s:s:\<n\> handler\_name=Japanese \-metadata creation\_time=\<original\> \-brand \<original major brand\> \-f mp4|mov \<name\>.kakitori.tmp.\<ext\>

* \<n\> \= index of the new subtitle stream (count existing subtitle streams first).  
* \-c:s:\<n\> mov\_text converts only the new stream. Existing subtitle or caption streams are copied untouched, never re-encoded.  
* Language tag is always jpn (shows as "Japanese" in VLC). handler\_name=Japanese sets the track label VLC displays, and a jpn subtitle stream labelled Japanese is also how Kakitori recognises a Video it has already processed. (Settled during implementation: the planned file-level kakitori=1 tag needed \-movflags use\_metadata\_tags, which hid the title from Apple's AVFoundation, so it was dropped.) ffmpeg drops creation\_time when copying tags, so it is passed explicitly; \-brand and \-f keep the original container and brand.  
* Supported inputs: .mp4, .m4v, .mov (container kept). Anything else (MKV, AVI, …) fails with a clear message; no conversion or re-encoding in v1.

## **Config, status and file layout**

All state lives in \<userdatadir\>/kakitori/, where \<userdatadir\> \= vlc.config.userdatadir().

| File | Written by | Contents |
| :---- | :---- | :---- |
| config.json | Lua | apiKey |
| job.json | Lua | id, inputPath, createdAt |
| status.json | Core | id (from job.json), state (extracting, transcribing, muxing, waiting-for-unlock, done, error), inputPath, message, updatedAt |
| log.txt | Core | Append-only run log; never contains the API key |
| bin/ | Installer | kakitori(.exe), ffmpeg(.exe), ffprobe(.exe) |

**Security rules**

* The API key is never passed on the command line or written to logs.  
* The key is stored in plain text; the README states this.  
* macOS: after writing config.json, Lua runs chmod 600 on it. (The installer can't: the file doesn't exist until the user saves a key.)

## **Platform specifics**

|  | Windows x64 | macOS (arm64, x64) |
| :---- | :---- | :---- |
| Extension folder | %APPDATA%\\vlc\\lua\\extensions\\ | \~/Library/Application Support/org.videolan.vlc/lua/extensions/ |
| Detect OS in Lua | package.config:sub(1,1) \== "\\\\" | otherwise |
| Launch (from Lua) | os.execute('start "" /b "\<bin\>"') | os.execute('"\<bin\>" \>/dev/null 2\>&1 &') |
| Console window | Build with Bun's hide-console option so no window flashes | n/a |
| Installer | install.ps1 | install.sh |
| Unsigned binary | SmartScreen warning; user clicks through | Gatekeeper block; installer runs xattr \-d com.apple.quarantine on bin/ |

**Path handling**

* Quote every path; video names often contain spaces and non-ASCII (Japanese) characters.  
* Pass nothing on the command line; the video path travels inside UTF-8 job.json. This avoids Windows code-page mangling of Japanese file names in os.execute.  
* Risk: if \<userdatadir\> itself contains non-ASCII characters (e.g. a Japanese Windows username), the binary path in os.execute can still break, and so can Lua's io.open when writing config.json and job.json (VLC 3 Lua likely opens files with the ANSI code page on Windows). Test both.

**Signing:** out of scope for v1. Revisit Apple notarization (\$99/yr developer account) if macOS install friction becomes a support burden.

## **Error handling**

Every failure in the core sets status.json to error with a one-line human message, logs details to log.txt, and shows the message in the error popup. The one exception is a rejected second Transcription, which shows its popup but never touches status.json, so the running Transcription's status stays correct.

| Failure | Detected by | User message / action |
| :---- | :---- | :---- |
| No API key | Lua | Opens key dialog |
| Core never starts (e.g. blocked by antivirus, SmartScreen or Gatekeeper) | Lua (job.json older than 60 s still there, on the next Transcribe or Show last status) | "Kakitori didn't start. Your antivirus or macOS security may have blocked it. See the README." |
| Invalid key (401) | Core | "API key rejected. Use Change API key." |
| Quota / billing (402/429) | Core | Show ElevenLabs' error text; no retry |
| Connection failure or 5xx | Core | Retry up to 3 times with backoff (2 s, 4 s, 8 s), then error |
| No answer within 15 minutes | Core (request timeout) | "ElevenLabs took too long. Try again later." No retry: ElevenLabs may still finish and bill the attempt |
| Popup fails to show | Core (non-zero exit from osascript / PowerShell) | Log it; result still available via Show last status |
| No audio stream | Core (ffprobe) | "No audio track found." |
| Unsupported container (e.g. AVI) | Lua skips these during target selection; Core checks again for CLI use (extension check during validation, before extraction) | "Subtitles can't be added to this file type." |
| File exceeds API size/duration limit | Core (pre-check) | State the limit; no upload |
| File already has our subtitle track | Core (jpn subtitle track labelled Japanese) | Skip transcription; popup says "Japanese subtitles are already in \<name\>" |
| Video still locked after 2 minutes | Core (rename fails) | Keep the Pending copy; "Close the video in VLC, then click Transcribe again." |
| Second Transcription while one is running | Core (lock file with PID in state folder; a lock whose PID is no longer running is stale and removed) | "A transcription is already running." status.json is not touched |

## **Build, release and repo**

**Repo structure**

kakitori-vlc/  
  extension/kakitori.lua  
  core/src/            \# index.ts, job.ts, audio.ts, scribe.ts, srt.ts, mux.ts, notify.ts, status.ts  
  core/test/           \# unit tests \+ sample media  
  install/install.ps1  
  install/install.sh, uninstall.ps1, uninstall.sh  
  .github/workflows/release.yml  
  README.md  LICENSE  THIRD\_PARTY.md  
**Build**

* bun build \--compile with targets bun-windows-x64, bun-darwin-arm64, bun-darwin-x64.  
* ffmpeg and ffprobe: static builds per target, fetched in CI and bundled into each release zip.  
* GitHub Actions builds all three targets on tag push and attaches one zip per platform to the GitHub Release.

Release zip contents: kakitori.lua, bin/ (core \+ ffmpeg \+ ffprobe), README. Each release also attaches install.ps1, install.sh, uninstall.ps1, uninstall.sh and SHA256SUMS.txt as separate assets, so releases/latest/download/\<file\> always resolves to the newest version.

**Installer (install.ps1 / install.sh)**

1\. Detect OS and CPU (Windows x64; macOS arm64 or x64). Anything else: print "Not supported" and exit.

2\. Download the matching zip from the same release and check it against SHA256SUMS.txt; stop on mismatch.

3\. Copy kakitori.lua to the VLC extensions folder (see Platform specifics), creating the folder if missing.

4\. Copy bin/ to \<userdatadir\>/kakitori/bin/. macOS: chmod \+x and remove the quarantine attribute.

5\. Re-running the command upgrades in place and never touches config.json, so the saved API key survives.

6\. Print "Done. Restart VLC, then View → Kakitori → Transcribe." (macOS: VLC → Extensions → Kakitori → Transcribe).

7\. Uninstall is a separate one-liner (uninstall.ps1 / uninstall.sh), because irm | iex and curl | sh make passing flags awkward. Windows (PowerShell): irm https\://github.com/\<owner\>/kakitori-vlc/releases/latest/download/uninstall.ps1 | iex. macOS (Terminal): curl \-fsSL https\://github.com/\<owner\>/kakitori-vlc/releases/latest/download/uninstall.sh | sh. It stops any running kakitori job, then deletes kakitori.lua and the whole kakitori folder (bin, config.json with the API key, status, log), and prints "Uninstalled. Restart VLC." Subtitle tracks already added to videos stay in those files.

**Licensing**

* Project code: MIT.  
* ffmpeg builds are GPL or LGPL depending on build flags. Bundling as a separate executable is allowed; ship its license and a source link in THIRD\_PARTY.md.

README must cover: the one-line install command per OS and what it does, the one-line uninstall command per OS, BYO ElevenLabs key and that usage is billed to the user's account, plain-text key storage, that the video's audio is uploaded to ElevenLabs (link their privacy policy), Gatekeeper/SmartScreen warnings and what to do if antivirus blocks Kakitori, and that v1 supports videos on local drives only (not iCloud Drive, network shares or exFAT external drives). It must also say what happens to the Video: it is rewritten in place; its modified date is kept, but on macOS Finder tags, Finder comments and the creation date are lost; extra camera data (e.g. iPhone data tracks) may be removed when it can't be copied; a Video that already has a Subtitle track is never transcribed again; if the Video was in use, a Pending copy (\<name\>.kakitori.tmp.\<ext\>, as large as the Video) stays next to it until Transcribe is clicked again; and a Transcription that times out may still be billed by ElevenLabs.

**Build order**

1\. Spikes (throwaway code, before anything else): a minimal VLC 3 Lua extension that lists playlist items and paths, opens an add\_password() dialog, and launches a dummy binary with os.execute on Windows and macOS; confirms VLC calls activate() before trigger\_menu() on every menu click; writes a file with io.open under a non-ASCII folder on Windows; checks the launched binary keeps running after VLC quits; a popup test with a Japanese file name; a mux of an iPhone clip checked for surviving title, date and location. These cover the risky items under "Verify before building"; if one fails, update the spec before continuing.

2\. Core as a CLI (kakitori \<video\>): port the existing script, then add audio extraction, Scribe call, SRT, mux, ffprobe verify and safe swap. Test with MP4, MOV (including an iPhone clip) and Japanese file names.

3\. Core robustness: status.json, log.txt, lock file, retries, locked-file swap, every row of the error table, and the system popup.

4\. Compile: bun build \--compile for all three targets with ffmpeg/ffprobe alongside in bin/; run the CLI on real Windows and macOS machines.

5\. Lua extension: menu, key dialog, target selection, job.json, launch, Show last status. Test end to end against the compiled core.

6\. Installer and uninstaller (install/uninstall .ps1 and .sh), tested against a local zip first.

7\. CI release workflow: build on tag, zips, SHA256SUMS.txt, script assets; then run the one-line install from a real GitHub release.

8\. README and THIRD\_PARTY.md.

9\. Acceptance pass on a clean Windows 11 and Apple Silicon Mac against "v1 is done when".

## **Acceptance criteria and open items**

**v1 is done when**

* ☐ Fresh install on Windows 11 and macOS (Apple Silicon) works via the one-line install command alone, and re-running it upgrades without losing the saved key.  
* ☐ First run prompts for the key; later runs do not.  
* ☐ A queued Japanese MP4 with a Japanese file name gains a selectable "Japanese" track in the same file; no other files are left next to it.  
* ☐ The same output shows subtitles in QuickTime/Apple TV app and Windows Media Player (Films & TV).  
* ☐ VLC stays responsive during transcription.  
* ☐ A 60-minute video completes without manual steps.  
* ☐ Each failure in the error table produces its stated message.  
* ☐ The API key appears in no log, command line, or process list.

**Verify before building (unconfirmed assumptions)**

1. ☐ Scribe v2: file size limit (docs say 3 GB; API reference says under 5 GB) and 10-hour duration limit, which only matter for very long files now that only audio is uploaded; response format (word item type values) unchanged from the existing script.  
2. ☐ VLC 3 Lua: playlist API returns items in add order and exposes local paths; add\_password() availability; VLC calls activate() before every trigger\_menu(); whether a never-played item's duration is known (else "(length unknown)"); io.open can write config.json and job.json when \<userdatadir\> has non-ASCII characters on Windows.  
3. ☐ Windows: os.execute from VLC goes through cmd.exe; check it doesn't flash a console window or block VLC while start launches the core.  
4. ☐ Mux: \-map 0 \-c copy on iPhone/camera MOV files, which often carry data or timecode tracks ffmpeg can't copy. Confirm the automatic \-map \-0:d? retry (step 6) works and that the stream check passes with only data streams missing.  
5. ☐ Popup: Japanese file names display correctly via osascript and PowerShell \-EncodedCommand; no console window flashes on Windows. macOS: the osascript dialog appears in front when launched from a background process and triggers no permission prompt; if not, fall back to display notification.  
6. ☐ Bun: hide-console flag for Windows builds.  
7. ☐ Whether VLC auto-selects the embedded track or the user must pick it; that VLC labels it "Japanese"; that the title, date and location still show in QuickTime, Photos and Windows after the mux (use\_metadata\_tags was dropped after it hid the title from AVFoundation).  
8. ☐ Replacing the original while VLC has it open (especially Windows file locks): rename succeeds, or fails with "Close the video in VLC, then click Transcribe again."  
9. ☐ The core keeps running when the user quits VLC mid-Transcription (Windows start /b and macOS & launch).  
10. ☐ Windows Defender doesn't flag or quarantine the Bun-compiled binary; if it does, note it in the README next to SmartScreen.

