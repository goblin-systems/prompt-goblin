export function normalizeHotkey(value: string): string {
  const normalized = value.replace(/\s+/g, "");
  return normalized || "Alt+G";
}

export function fingerprintApiKey(apiKey: string): string {
  let hash = 5381;
  for (let i = 0; i < apiKey.length; i += 1) {
    hash = (hash * 33) ^ apiKey.charCodeAt(i);
  }
  return String(hash >>> 0);
}

export function fingerprintCredential(identity: string): string {
  return fingerprintApiKey(identity);
}

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
