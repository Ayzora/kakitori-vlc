import { loadDefaultJapaneseParser } from "budoux";

const MAX_CHARS_PER_LINE = 16;
const MAX_LINES = 2;
const MAX_CUE_SECONDS = 7;
const COMMA_PAUSE_SECONDS = 1.0;
const LONG_PAUSE_SECONDS = 2.0;
const LEAD_IN_SECONDS = 0.2;
const LINGER_SECONDS = 0.7;
const MIN_CUE_SECONDS = 1.0;
const GAP_SECONDS = 0.1;

const SENTENCE_ENDS = new Set(["。", "？", "！", "?", "!"]);

export type Word = { text: string; start: number; end: number; type: string };
type Char = { char: string; start: number; end: number };
type Phrase = { text: string; start: number; end: number };
type Cue = { phrases: Phrase[]; start: number; end: number };

function toChars(words: Word[]): Char[] {
  return words
    .filter((word) => word.type === "word")
    .flatMap((word) =>
      [...word.text].map((char) => ({
        char,
        start: word.start,
        end: word.end,
      })),
    );
}

function splitSentences(chars: Char[]): Char[][] {
  const sentences: Char[][] = [];
  let current: Char[] = [];
  chars.forEach((char, i) => {
    current.push(char);
    const next = chars[i + 1];
    const pause = next ? next.start - char.end : Infinity;
    if (
      SENTENCE_ENDS.has(char.char) ||
      (char.char === "、" && pause >= COMMA_PAUSE_SECONDS)
    ) {
      sentences.push(current);
      current = [];
    }
  });
  if (current.length > 0) sentences.push(current);
  return sentences;
}

const parser = loadDefaultJapaneseParser();

function toPhrases(sentence: Char[]): Phrase[] {
  const text = sentence.map((c) => c.char).join("");
  let offset = 0;
  return parser.parse(text).map((phraseText) => {
    const slice = sentence.slice(offset, offset + [...phraseText].length);
    offset += slice.length;
    return {
      text: phraseText,
      start: slice[0]!.start,
      end: slice[slice.length - 1]!.end,
    };
  });
}

function longest(lines: string[]) {
  return Math.max(...lines.map((line) => line.length));
}

function wrap(phrases: string[]): string[] {
  const text = phrases.join("");
  if (text.length <= MAX_CHARS_PER_LINE) return [text];

  let best: string[] | null = null;
  for (let i = 1; i < phrases.length; i++) {
    const lines = [phrases.slice(0, i).join(""), phrases.slice(i).join("")];
    if (
      longest(lines) <= MAX_CHARS_PER_LINE &&
      (!best || longest(lines) < longest(best))
    ) {
      best = lines;
    }
  }
  if (best) return best;

  const lines: string[] = [""];
  for (const phrase of phrases) {
    if (lines[lines.length - 1]!.length + phrase.length > MAX_CHARS_PER_LINE)
      lines.push("");
    lines[lines.length - 1] += phrase;
    while (lines[lines.length - 1]!.length > MAX_CHARS_PER_LINE) {
      const last = lines.pop()!;
      lines.push(
        last.slice(0, MAX_CHARS_PER_LINE),
        last.slice(MAX_CHARS_PER_LINE),
      );
    }
  }
  return lines;
}

function toCues(sentence: Phrase[]): Cue[] {
  const cues: Cue[] = [];
  for (const phrase of sentence) {
    const cue = cues[cues.length - 1];
    const fits =
      cue &&
      wrap([...cue.phrases, phrase].map((p) => p.text)).length <= MAX_LINES &&
      phrase.end - cue.start <= MAX_CUE_SECONDS &&
      phrase.start - cue.end < LONG_PAUSE_SECONDS;
    if (fits) {
      cue.phrases.push(phrase);
      cue.end = phrase.end;
    } else {
      cues.push({ phrases: [phrase], start: phrase.start, end: phrase.end });
    }
  }
  return cues;
}

function adjustTimings(cues: Cue[]) {
  cues.forEach((cue, i) => {
    const previous = cues[i - 1];
    const limit = previous ? previous.end + GAP_SECONDS : 0;
    cue.start = Math.min(
      cue.start,
      Math.max(cue.start - LEAD_IN_SECONDS, limit),
    );
  });
  cues.forEach((cue, i) => {
    const next = cues[i + 1];
    const limit = next ? next.start - GAP_SECONDS : Infinity;
    const wanted = Math.max(
      cue.end + LINGER_SECONDS,
      cue.start + MIN_CUE_SECONDS,
    );
    cue.end = Math.max(cue.end, Math.min(wanted, limit));
  });
}

function srtTime(seconds: number) {
  const ms = Math.round(seconds * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

function toSrt(cues: Cue[]) {
  return cues
    .map((cue, i) => {
      const lines = wrap(cue.phrases.map((p) => p.text));
      return `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${lines.join("\n")}\n`;
    })
    .join("\n");
}

export function buildSrt(words: Word[]): string {
  const cues = splitSentences(toChars(words)).flatMap((sentence) =>
    toCues(toPhrases(sentence)),
  );
  adjustTimings(cues);
  return toSrt(cues);
}
