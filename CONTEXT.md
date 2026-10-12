# Kakitori VLC

A VLC extension that transcribes a Japanese video with ElevenLabs and adds the result as a subtitle track inside the same video file.

## Language

**Transcription**:
One run, from the user clicking Transcribe in VLC to the popup that says the Subtitle track was added or why it failed.
_Avoid_: Job, task, run

**Video**:
The local MP4, M4V or MOV file the user picked, which gains the Subtitle track in place.
_Avoid_: Source, input, original, target, media file

**Subtitle track**:
The soft Japanese subtitle track Kakitori adds inside a Video.
_Avoid_: Transcript file, subtitle file, SRT, subs

**Pending copy**:
A finished copy of a Video, already carrying the Subtitle track, kept next to it because the Video was in use when the swap was due. The next Transcription of that Video uses it instead of transcribing again.
_Avoid_: Temp file, pendingSwap, kept copy
