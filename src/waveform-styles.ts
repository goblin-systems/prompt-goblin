export const WAVEFORM_STYLES = ["classic", "bars", "pulse", "bloom", "fan"] as const;
export const WAVEFORM_COLOR_SCHEMES = [
  "aurora",
  "ember",
  "glacier",
  "sunset",
  "monochrome",
] as const;

export type WaveformStyle = (typeof WAVEFORM_STYLES)[number];
export type WaveformColorScheme = (typeof WAVEFORM_COLOR_SCHEMES)[number];

interface WaveformPalette {
  horizontalStart: string;
  horizontalMid: string;
  horizontalEnd: string;
  verticalTop: string;
  verticalMid: string;
  verticalBottom: string;
  glow: string;
  progressStart: string;
  progressEnd: string;
  label: string;
}

const WAVEFORM_PALETTES: Record<WaveformColorScheme, WaveformPalette> = {
  aurora: {
    horizontalStart: "rgba(108, 99, 255, 0.3)",
    horizontalMid: "rgba(74, 222, 128, 0.95)",
    horizontalEnd: "rgba(108, 99, 255, 0.3)",
    verticalTop: "rgba(167, 139, 250, 0.7)",
    verticalMid: "rgba(74, 222, 128, 0.95)",
    verticalBottom: "rgba(34, 211, 238, 0.62)",
    glow: "rgba(74, 222, 128, 0.45)",
    progressStart: "rgba(251, 191, 36, 0.95)",
    progressEnd: "rgba(248, 113, 113, 0.9)",
    label: "Aurora",
  },
  ember: {
    horizontalStart: "rgba(251, 146, 60, 0.34)",
    horizontalMid: "rgba(248, 113, 113, 0.98)",
    horizontalEnd: "rgba(245, 158, 11, 0.34)",
    verticalTop: "rgba(253, 186, 116, 0.78)",
    verticalMid: "rgba(248, 113, 113, 0.94)",
    verticalBottom: "rgba(239, 68, 68, 0.66)",
    glow: "rgba(248, 113, 113, 0.42)",
    progressStart: "rgba(253, 224, 71, 0.96)",
    progressEnd: "rgba(239, 68, 68, 0.9)",
    label: "Ember",
  },
  glacier: {
    horizontalStart: "rgba(96, 165, 250, 0.3)",
    horizontalMid: "rgba(125, 211, 252, 0.95)",
    horizontalEnd: "rgba(45, 212, 191, 0.3)",
    verticalTop: "rgba(191, 219, 254, 0.76)",
    verticalMid: "rgba(125, 211, 252, 0.92)",
    verticalBottom: "rgba(45, 212, 191, 0.62)",
    glow: "rgba(96, 165, 250, 0.38)",
    progressStart: "rgba(165, 243, 252, 0.95)",
    progressEnd: "rgba(96, 165, 250, 0.88)",
    label: "Glacier",
  },
  sunset: {
    horizontalStart: "rgba(244, 114, 182, 0.32)",
    horizontalMid: "rgba(251, 191, 36, 0.96)",
    horizontalEnd: "rgba(249, 115, 22, 0.34)",
    verticalTop: "rgba(251, 207, 232, 0.76)",
    verticalMid: "rgba(251, 191, 36, 0.93)",
    verticalBottom: "rgba(249, 115, 22, 0.66)",
    glow: "rgba(251, 191, 36, 0.4)",
    progressStart: "rgba(253, 224, 71, 0.96)",
    progressEnd: "rgba(236, 72, 153, 0.9)",
    label: "Sunset",
  },
  monochrome: {
    horizontalStart: "rgba(148, 163, 184, 0.25)",
    horizontalMid: "rgba(241, 245, 249, 0.95)",
    horizontalEnd: "rgba(148, 163, 184, 0.25)",
    verticalTop: "rgba(226, 232, 240, 0.68)",
    verticalMid: "rgba(241, 245, 249, 0.92)",
    verticalBottom: "rgba(148, 163, 184, 0.55)",
    glow: "rgba(226, 232, 240, 0.26)",
    progressStart: "rgba(248, 250, 252, 0.92)",
    progressEnd: "rgba(148, 163, 184, 0.82)",
    label: "Monochrome",
  },
};

export function isWaveformStyle(value: unknown): value is WaveformStyle {
  return typeof value === "string" && WAVEFORM_STYLES.includes(value as WaveformStyle);
}

export function isWaveformColorScheme(value: unknown): value is WaveformColorScheme {
  return (
    typeof value === "string" &&
    WAVEFORM_COLOR_SCHEMES.includes(value as WaveformColorScheme)
  );
}

export function cycleWaveformStyle(current: WaveformStyle): WaveformStyle {
  const index = WAVEFORM_STYLES.indexOf(current);
  return WAVEFORM_STYLES[(index + 1) % WAVEFORM_STYLES.length];
}

export function cycleWaveformColorScheme(
  current: WaveformColorScheme
): WaveformColorScheme {
  const index = WAVEFORM_COLOR_SCHEMES.indexOf(current);
  return WAVEFORM_COLOR_SCHEMES[(index + 1) % WAVEFORM_COLOR_SCHEMES.length];
}

export function getWaveformStyleLabel(style: WaveformStyle): string {
  if (style === "bloom") return "Bloom";
  if (style === "fan") return "Fan";
  if (style === "bars") return "Bars";
  if (style === "pulse") return "Pulse";
  return "Classic";
}

export function getWaveformColorSchemeLabel(scheme: WaveformColorScheme): string {
  return WAVEFORM_PALETTES[scheme].label;
}

export interface DrawWaveformOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  amplitude: number;
  phase: number;
  active: boolean;
  colorScheme: WaveformColorScheme;
}

function withAlpha(color: string, alpha: number): string {
  const match = color.match(/^rgba\((.+?),\s*([0-9.]+)\)$/);
  if (!match) {
    return color;
  }
  return `rgba(${match[1]}, ${Number(match[2]) * alpha})`;
}

function createHorizontalGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  palette: WaveformPalette,
  alpha = 1
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, withAlpha(palette.horizontalStart, alpha));
  gradient.addColorStop(0.5, withAlpha(palette.horizontalMid, alpha));
  gradient.addColorStop(1, withAlpha(palette.horizontalEnd, alpha));
  return gradient;
}

function createVerticalGradient(
  ctx: CanvasRenderingContext2D,
  height: number,
  palette: WaveformPalette,
  alpha = 1
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, withAlpha(palette.verticalTop, alpha));
  gradient.addColorStop(0.45, withAlpha(palette.verticalMid, alpha));
  gradient.addColorStop(1, withAlpha(palette.verticalBottom, alpha));
  return gradient;
}

function drawClassic({ ctx, width, height, amplitude, phase, colorScheme }: DrawWaveformOptions) {
  const palette = WAVEFORM_PALETTES[colorScheme];
  const baseY = height / 2;

  ctx.lineWidth = 2;
  ctx.strokeStyle = createHorizontalGradient(ctx, width, palette);
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = 12;
  ctx.beginPath();

  for (let x = 0; x <= width; x += 2) {
    const progress = x / Math.max(width, 1);
    const envelope = Math.sin(progress * Math.PI);
    const y =
      baseY +
      Math.sin(progress * 10 + phase) * amplitude * envelope +
      Math.sin(progress * 22 + phase * 1.8) * amplitude * 0.16;

    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawBars({ ctx, width, height, amplitude, phase, active, colorScheme }: DrawWaveformOptions) {
  const palette = WAVEFORM_PALETTES[colorScheme];
  const baseY = height / 2;
  const barStep = 6;
  const barWidth = 3;
  const idleHeight = Math.max(2, height * 0.08);
  const maxHeight = Math.max(idleHeight + 2, Math.min(height * 0.92, idleHeight + amplitude * 2.4));

  ctx.fillStyle = createVerticalGradient(ctx, height, palette, active ? 1 : 0.72);
  ctx.shadowColor = withAlpha(palette.glow, 0.84);
  ctx.shadowBlur = active ? 10 : 0;

  for (let x = 0; x <= width; x += barStep) {
    const progress = x / Math.max(width, 1);
    const rippleA = Math.sin(progress * 18 - phase * 1.9);
    const rippleB = Math.sin(progress * 8 + phase * 1.15);
    const ripple = Math.max(0, rippleA * 0.72 + rippleB * 0.28);
    const energy = active ? 0.2 + ripple * 0.8 : 0;
    const barHeight = idleHeight + (maxHeight - idleHeight) * energy;
    const top = baseY - barHeight / 2;
    ctx.fillRect(x, top, barWidth, barHeight);
  }

  ctx.shadowBlur = 0;
}

function drawPulse({ ctx, width, height, amplitude, phase, active, colorScheme }: DrawWaveformOptions) {
  const palette = WAVEFORM_PALETTES[colorScheme];
  const baseY = height / 2;
  const shapeAmplitude = active ? Math.max(3, amplitude * 1.25) : 0;

  ctx.fillStyle = createVerticalGradient(ctx, height, palette, 0.28);
  ctx.beginPath();

  for (let x = 0; x <= width; x += 4) {
    const progress = x / Math.max(width, 1);
    const envelope = 0.32 + Math.sin(progress * Math.PI) * 0.68;
    const ripple =
      Math.sin(progress * 8 + phase * 0.95) +
      Math.sin(progress * 17 - phase * 1.6) * 0.35;
    const y = baseY - shapeAmplitude * envelope * ripple * 0.7;
    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }

  for (let x = width; x >= 0; x -= 4) {
    const progress = x / Math.max(width, 1);
    const envelope = 0.32 + Math.sin(progress * Math.PI) * 0.68;
    const ripple =
      Math.sin(progress * 8 + phase * 0.95) +
      Math.sin(progress * 17 - phase * 1.6) * 0.35;
    const y = baseY + shapeAmplitude * envelope * ripple * 0.7;
    ctx.lineTo(x, y);
  }

  ctx.closePath();
  ctx.fill();

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = createHorizontalGradient(ctx, width, palette);
  ctx.shadowColor = withAlpha(palette.glow, 0.88);
  ctx.shadowBlur = active ? 10 : 0;

  ctx.beginPath();
  for (let x = 0; x <= width; x += 3) {
    const progress = x / Math.max(width, 1);
    const envelope = 0.32 + Math.sin(progress * Math.PI) * 0.68;
    const ripple =
      Math.sin(progress * 8 + phase * 0.95) +
      Math.sin(progress * 17 - phase * 1.6) * 0.35;
    const y = baseY + shapeAmplitude * envelope * ripple * 0.45;
    if (x === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawBloom({ ctx, width, height, amplitude, phase, active, colorScheme }: DrawWaveformOptions) {
  const palette = WAVEFORM_PALETTES[colorScheme];
  const centerX = width / 2;
  const baseY = height / 2;
  const maxRadius = width / 2;
  const rings = 24;
  const shapeAmplitude = active ? Math.max(4, amplitude * 1.4) : 0;

  ctx.lineWidth = 1.8;
  ctx.strokeStyle = createHorizontalGradient(ctx, width, palette);
  ctx.shadowColor = withAlpha(palette.glow, 0.9);
  ctx.shadowBlur = active ? 12 : 0;

  for (let i = 0; i < rings; i += 1) {
    const ringProgress = (i + 1) / rings;
    const distance = ringProgress * maxRadius;
    const envelope = Math.pow(1 - ringProgress, 0.45);
    const ripple =
      Math.sin(phase * 1.15 - ringProgress * 12) * 0.7 +
      Math.sin(phase * 0.65 - ringProgress * 6.5) * 0.3;
    const halfHeight = 1 + shapeAmplitude * envelope * Math.max(0.15, ripple + 0.45);

    ctx.beginPath();
    ctx.moveTo(centerX - distance, baseY - halfHeight);
    ctx.lineTo(centerX - distance, baseY + halfHeight);
    ctx.moveTo(centerX + distance, baseY - halfHeight);
    ctx.lineTo(centerX + distance, baseY + halfHeight);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
}

function drawFan({ ctx, width, height, amplitude, phase, active, colorScheme }: DrawWaveformOptions) {
  const palette = WAVEFORM_PALETTES[colorScheme];
  const centerX = width / 2;
  const baseY = height / 2;
  const maxReach = width / 2;
  const shapeAmplitude = active ? Math.max(4, amplitude * 1.15) : 0;

  ctx.fillStyle = createVerticalGradient(ctx, height, palette, 0.22);
  ctx.strokeStyle = createHorizontalGradient(ctx, width, palette);
  ctx.lineWidth = 1.6;
  ctx.shadowColor = withAlpha(palette.glow, 0.85);
  ctx.shadowBlur = active ? 10 : 0;

  ctx.beginPath();
  ctx.moveTo(centerX, baseY);
  for (let distance = 0; distance <= maxReach; distance += 3) {
    const progress = distance / Math.max(maxReach, 1);
    const envelope = Math.sin(progress * Math.PI * 0.95);
    const ripple =
      Math.sin(phase * 1.25 + progress * 10) +
      Math.sin(phase * 0.82 + progress * 18) * 0.24;
    const y = baseY - shapeAmplitude * envelope * ripple * 0.58;
    ctx.lineTo(centerX + distance, y);
  }
  for (let distance = maxReach; distance >= 0; distance -= 3) {
    const progress = distance / Math.max(maxReach, 1);
    const envelope = Math.sin(progress * Math.PI * 0.95);
    const ripple =
      Math.sin(phase * 1.25 + progress * 10) +
      Math.sin(phase * 0.82 + progress * 18) * 0.24;
    const y = baseY + shapeAmplitude * envelope * ripple * 0.58;
    ctx.lineTo(centerX + distance, y);
  }
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(centerX, baseY);
  for (let distance = 0; distance <= maxReach; distance += 3) {
    const progress = distance / Math.max(maxReach, 1);
    const envelope = Math.sin(progress * Math.PI * 0.95);
    const ripple =
      Math.sin(phase * 1.25 + progress * 10) +
      Math.sin(phase * 0.82 + progress * 18) * 0.24;
    const y = baseY - shapeAmplitude * envelope * ripple * 0.58;
    ctx.lineTo(centerX + distance, y);
  }
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX, baseY);
  for (let distance = 0; distance <= maxReach; distance += 3) {
    const progress = distance / Math.max(maxReach, 1);
    const envelope = Math.sin(progress * Math.PI * 0.95);
    const ripple =
      Math.sin(phase * 1.25 + progress * 10) +
      Math.sin(phase * 0.82 + progress * 18) * 0.24;
    const y = baseY + shapeAmplitude * envelope * ripple * 0.58;
    ctx.lineTo(centerX + distance, y);
  }
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX, baseY);
  for (let distance = 0; distance <= maxReach; distance += 3) {
    const progress = distance / Math.max(maxReach, 1);
    const envelope = Math.sin(progress * Math.PI * 0.95);
    const ripple =
      Math.sin(phase * 1.25 + progress * 10) +
      Math.sin(phase * 0.82 + progress * 18) * 0.24;
    const y = baseY - shapeAmplitude * envelope * ripple * 0.58;
    ctx.lineTo(centerX - distance, y);
  }
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX, baseY);
  for (let distance = 0; distance <= maxReach; distance += 3) {
    const progress = distance / Math.max(maxReach, 1);
    const envelope = Math.sin(progress * Math.PI * 0.95);
    const ripple =
      Math.sin(phase * 1.25 + progress * 10) +
      Math.sin(phase * 0.82 + progress * 18) * 0.24;
    const y = baseY + shapeAmplitude * envelope * ripple * 0.58;
    ctx.lineTo(centerX - distance, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

export function createWaveProgressGradient(
  ctx: CanvasRenderingContext2D,
  height: number,
  colorScheme: WaveformColorScheme
): CanvasGradient {
  const palette = WAVEFORM_PALETTES[colorScheme];
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, palette.progressStart);
  gradient.addColorStop(1, palette.progressEnd);
  return gradient;
}

export function drawWaveform(style: WaveformStyle, options: DrawWaveformOptions) {
  if (style === "bars") {
    drawBars(options);
    return;
  }

  if (style === "pulse") {
    drawPulse(options);
    return;
  }

  if (style === "bloom") {
    drawBloom(options);
    return;
  }

  if (style === "fan") {
    drawFan(options);
    return;
  }

  drawClassic(options);
}
