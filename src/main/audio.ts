import { base64ToBytes, bytesToBase64, resampleMono } from "./utils";

const PCM_CHUNK_BYTE_SIZE = 640;
const TAIL_SILENCE_CHUNKS = 15;
const TARGET_SAMPLE_RATE = 16000;

export async function wavToPcmChunksBase64(wavBase64: string): Promise<string[]> {
  const wavBytes = base64ToBytes(wavBase64);
  const buffer = wavBytes.buffer.slice(
    wavBytes.byteOffset,
    wavBytes.byteOffset + wavBytes.byteLength
  ) as ArrayBuffer;

  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextCtor) {
    throw new Error("AudioContext is not available for WAV decoding");
  }

  const audioContext = new AudioContextCtor();
  let decoded: AudioBuffer;
  try {
    decoded = await audioContext.decodeAudioData(buffer.slice(0));
  } finally {
    await audioContext.close();
  }

  const sourceRate = decoded.sampleRate;
  const channels = decoded.numberOfChannels;
  const frameCount = decoded.length;
  if (frameCount === 0) {
    return [];
  }

  const mono = new Float32Array(frameCount);
  for (let ch = 0; ch < channels; ch += 1) {
    const channelData = decoded.getChannelData(ch);
    for (let i = 0; i < frameCount; i += 1) {
      mono[i] += channelData[i] / channels;
    }
  }

  const mono16k = resampleMono(mono, sourceRate, TARGET_SAMPLE_RATE);
  const pcmBytes = new Uint8Array(mono16k.length * 2);

  for (let i = 0; i < mono16k.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, mono16k[i]));
    const intSample = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
    pcmBytes[i * 2] = intSample & 0xff;
    pcmBytes[i * 2 + 1] = (intSample >> 8) & 0xff;
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < pcmBytes.length; offset += PCM_CHUNK_BYTE_SIZE) {
    const chunk = pcmBytes.subarray(
      offset,
      Math.min(offset + PCM_CHUNK_BYTE_SIZE, pcmBytes.length)
    );
    if (chunk.length > 0) {
      chunks.push(bytesToBase64(chunk));
    }
  }

  const silenceChunk = new Uint8Array(PCM_CHUNK_BYTE_SIZE);
  for (let i = 0; i < TAIL_SILENCE_CHUNKS; i += 1) {
    chunks.push(bytesToBase64(silenceChunk));
  }

  return chunks;
}
