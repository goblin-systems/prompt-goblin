export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

export function resampleMono(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number
): Float32Array {
  if (sourceRate === targetRate) {
    return samples;
  }

  const ratio = sourceRate / targetRate;
  const targetLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(targetLength);

  for (let i = 0; i < targetLength; i += 1) {
    const sourceIndex = i * ratio;
    const index0 = Math.floor(sourceIndex);
    const index1 = Math.min(index0 + 1, samples.length - 1);
    const frac = sourceIndex - index0;
    output[i] = samples[index0] * (1 - frac) + samples[index1] * frac;
  }

  return output;
}

export function pcm16BytesToFloat32Mono(pcmBytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(pcmBytes.length / 2);
  const samples = new Float32Array(sampleCount);

  for (let i = 0; i < sampleCount; i += 1) {
    const low = pcmBytes[i * 2] ?? 0;
    const high = pcmBytes[i * 2 + 1] ?? 0;
    const value = (high << 8) | low;
    const signed = value >= 0x8000 ? value - 0x10000 : value;
    samples[i] = signed < 0 ? signed / 32768 : signed / 32767;
  }

  return samples;
}

export function float32MonoToPcm16Bytes(samples: Float32Array): Uint8Array {
  const pcmBytes = new Uint8Array(samples.length * 2);

  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const intSample = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
    pcmBytes[i * 2] = intSample & 0xff;
    pcmBytes[i * 2 + 1] = (intSample >> 8) & 0xff;
  }

  return pcmBytes;
}

export function pcm16ToWavBytes(pcmBytes: Uint8Array, sampleRate = 16000): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcmBytes.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  const out = new Uint8Array(buffer);
  out.set(pcmBytes, 44);
  return out;
}
