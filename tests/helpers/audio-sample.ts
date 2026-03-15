import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SAMPLE_PCM_CHUNK_BYTE_SIZE = 640;
const SAMPLE_TAIL_SILENCE_CHUNKS = 15;

export const EXPECTED_SAMPLE_TRANSCRIPT = "Red Fox jumps over the lazy dog.";
export const EXPECTED_LONG_SAMPLE_TRANSCRIPT = `Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do. Once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it.

And what is the use of a book, thought Alice, without pictures or conversations?`;
export const LONG_SAMPLE_REQUIRED_PASSAGES = [
  "Alice was beginning to get very tired",
  "of sitting by her sister",
  "and of having nothing to do",
  "Once or twice she had peeped into the book",
  "her sister was reading",
  "it had no pictures or conversations in it",
  "what is the use of a book",
  "thought Alice",
];

export const LONG_SAMPLE_BANNED_MARKERS = [
  "spoken noi",
  "begin quote",
  "start quote",
  "end quote",
  "finish quote",
];
export const LONG_SAMPLE_EXPECTED_SENTENCES = [
  "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do.",
  "Once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it.",
  "And what is the use of a book, thought Alice, without pictures or conversations?",
];

export function getSampleWavPath(): string {
  return join(fileURLToPath(new URL(".", import.meta.url)), "..", "sample.wav");
}

export function getLongSampleWavPath(): string {
  return join(fileURLToPath(new URL(".", import.meta.url)), "..", "long-sample.wav");
}

export function loadSampleWavBase64(): string {
  return readFileSync(getSampleWavPath()).toString("base64");
}

export function loadLongSampleWavBase64(): string {
  return readFileSync(getLongSampleWavPath()).toString("base64");
}

export function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countNormalizedOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let offset = 0;
  while (true) {
    const index = haystack.indexOf(needle, offset);
    if (index === -1) {
      return count;
    }
    count += 1;
    offset = index + needle.length;
  }
}

export function computeSentenceCoverage(actual: string, expected: string): number {
  const actualWords = new Set(normalizeTranscript(actual).split(" ").filter(Boolean));
  const expectedWords = normalizeTranscript(expected).split(" ").filter(Boolean);
  if (expectedWords.length === 0) {
    return 1;
  }

  let matched = 0;
  for (const word of expectedWords) {
    if (actualWords.has(word)) {
      matched += 1;
    }
  }

  return matched / expectedWords.length;
}

export function loadSamplePcmChunksBase64(): string[] {
  return loadPcmChunksBase64(getSampleWavPath());
}

export function loadLongSamplePcmChunksBase64(): string[] {
  return loadPcmChunksBase64(getLongSampleWavPath());
}

function loadPcmChunksBase64(filePath: string): string[] {
  const wavBytes = readFileSync(filePath);
  const pcmBytes = extractWavPcmData(wavBytes);
  const chunks: string[] = [];

  for (let offset = 0; offset < pcmBytes.length; offset += SAMPLE_PCM_CHUNK_BYTE_SIZE) {
    const chunk = pcmBytes.subarray(
      offset,
      Math.min(offset + SAMPLE_PCM_CHUNK_BYTE_SIZE, pcmBytes.length)
    );
    if (chunk.length > 0) {
      chunks.push(Buffer.from(chunk).toString("base64"));
    }
  }

  const silenceChunk = Buffer.alloc(SAMPLE_PCM_CHUNK_BYTE_SIZE).toString("base64");
  for (let index = 0; index < SAMPLE_TAIL_SILENCE_CHUNKS; index += 1) {
    chunks.push(silenceChunk);
  }

  return chunks;
}

function extractWavPcmData(wavBytes: Buffer): Buffer {
  if (wavBytes.length < 44) {
    throw new Error("Sample WAV is too small to parse");
  }

  if (wavBytes.toString("ascii", 0, 4) !== "RIFF" || wavBytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Sample WAV is not a RIFF/WAVE file");
  }

  let offset = 12;
  let formatTag = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataChunk: Buffer | null = null;

  while (offset + 8 <= wavBytes.length) {
    const chunkId = wavBytes.toString("ascii", offset, offset + 4);
    const chunkSize = wavBytes.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > wavBytes.length) {
      break;
    }

    if (chunkId === "fmt ") {
      formatTag = wavBytes.readUInt16LE(chunkStart);
      channelCount = wavBytes.readUInt16LE(chunkStart + 2);
      sampleRate = wavBytes.readUInt32LE(chunkStart + 4);
      bitsPerSample = wavBytes.readUInt16LE(chunkStart + 14);
    } else if (chunkId === "data") {
      dataChunk = wavBytes.subarray(chunkStart, chunkEnd);
    }

    offset = chunkEnd + (chunkSize % 2);
  }

  if (formatTag !== 1 || channelCount !== 1 || sampleRate !== 16000 || bitsPerSample !== 16 || !dataChunk) {
    throw new Error(
      `Sample WAV must be PCM mono 16-bit 16kHz (format=${formatTag}, channels=${channelCount}, rate=${sampleRate}, bits=${bitsPerSample}, hasData=${Boolean(dataChunk)})`
    );
  }

  return dataChunk;
}
