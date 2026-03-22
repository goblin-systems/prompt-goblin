import {
  createWaveProgressGradient,
  drawWaveform,
  type WaveformColorScheme,
  type WaveformStyle,
} from "@goblin-systems/goblin-design-system";
import type { MainDom } from "./dom";
import { LiveAudioSession } from "../live-audio-session";
import type { Settings, SttProvider } from "../settings";
import { base64ToBytes } from "./utils";
import { getProviderLabel } from "../stt/service";

export interface InputDeviceInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

type LogLevel = "INFO" | "WARN" | "ERROR";
export type MicTestMode = "timed" | "continuous";

interface MicTestControllerOptions {
  dom: MainDom;
  getCurrentSettings: () => Settings;
  getActiveProvider: () => SttProvider;
  getRecordingInputGain: () => number;
  debugLog: (message: string, level: LogLevel) => void;
}

const MIC_ACTIVITY_RMS_THRESHOLD = 0.01;
const MIC_TEST_DURATION_MS = 5000;

export class MicTestController {
  private active = false;
  private startedAt = 0;
  private autoStopTimer: number | null = null;
  private stopInProgress = false;
  private currentMode: MicTestMode | null = null;
  private session: LiveAudioSession<string | null> | null = null;
  private targetMicLevel = 0;
  private displayedMicLevel = 0;
  private phase = 0;
  private waveRaf = 0;
  private playbackActive = false;
  private lastPlaybackUrl: string | null = null;
  private lastAudio: HTMLAudioElement | null = null;
  private resizeHandler: (() => void) | null = null;

  constructor(private readonly options: MicTestControllerOptions) {}

  setupWave() {
    const ctx = this.options.dom.micWaveCanvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const cssWidth = this.options.dom.micWaveCanvas.clientWidth;
      const cssHeight = this.options.dom.micWaveCanvas.clientHeight || 64;
      this.options.dom.micWaveCanvas.width = Math.floor(cssWidth * ratio);
      this.options.dom.micWaveCanvas.height = Math.floor(cssHeight * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = () => {
      const width = this.options.dom.micWaveCanvas.clientWidth;
      const height = this.options.dom.micWaveCanvas.clientHeight || 64;
      const playbackActive = this.playbackActive && this.lastAudio !== null && !this.lastAudio.paused;
      const waveActive = this.active || playbackActive;
      const testProgress =
        this.active && this.startedAt > 0
          ? Math.min(1, (Date.now() - this.startedAt) / MIC_TEST_DURATION_MS)
          : 0;

      if (playbackActive && this.lastAudio) {
        const duration =
          Number.isFinite(this.lastAudio.duration) && this.lastAudio.duration > 0
            ? this.lastAudio.duration
            : 2.5;
        const progress = Math.min(1, this.lastAudio.currentTime / duration);
        const envelope = Math.sin(progress * Math.PI);
        const pulse =
          (Math.sin(this.lastAudio.currentTime * 14) +
            Math.sin(this.lastAudio.currentTime * 22 + 0.8) * 0.45 +
            Math.sin(this.lastAudio.currentTime * 31 + 1.7) * 0.2 +
            1.65) /
          2.3;
        this.targetMicLevel = Math.max(0.08, Math.min(1, envelope * (0.28 + pulse * 0.72)));
      }

      this.displayedMicLevel += (this.targetMicLevel - this.displayedMicLevel) * 0.15;
      if (!waveActive) {
        this.targetMicLevel = 0;
        this.displayedMicLevel *= 0.92;
      } else if (this.displayedMicLevel > 0.002) {
        this.phase += 0.12 + this.displayedMicLevel * 0.2;
      }

      ctx.clearRect(0, 0, width, height);

      const settings = this.options.getCurrentSettings();
      drawWaveform(settings.waveformStyle, {
        ctx,
        width,
        height,
        amplitude: waveActive ? this.displayedMicLevel * 20 : 0,
        phase: this.phase,
        active: waveActive,
        colorScheme: settings.waveformColorScheme,
      });

      if (this.active) {
        const progressX = Math.min(width - 1, Math.max(0, Math.floor(width * testProgress)));
        const sliderGradient = createWaveProgressGradient(
          ctx,
          height,
          settings.waveformColorScheme
        );

        ctx.lineWidth = 2;
        ctx.strokeStyle = sliderGradient;
        ctx.beginPath();
        ctx.moveTo(progressX, 0);
        ctx.lineTo(progressX, height);
        ctx.stroke();
      }

      this.waveRaf = requestAnimationFrame(draw);
    };

    resize();
    this.resizeHandler = resize;
    window.addEventListener("resize", resize);
    this.updateButtons();
    this.setSignalState(false, false);
    this.waveRaf = requestAnimationFrame(draw);
  }

  handleMicLevel(rms: number) {
    const receivingAudio = rms >= MIC_ACTIVITY_RMS_THRESHOLD;
    this.targetMicLevel = receivingAudio ? Math.min(1, rms * 14) : 0;
    if (!this.active) {
      return;
    }

    this.options.dom.micTestStatus.textContent = receivingAudio
      ? "Receiving audio"
      : this.currentMode === "continuous"
        ? "Listening until stopped..."
        : "Listening...";
    this.setSignalState(receivingAudio, true);
  }

  handleMonitoringStatus(monitoring: boolean) {
    this.active = monitoring;
    if (!this.active) {
      this.clearAutoStop();
      this.startedAt = 0;
      this.targetMicLevel = 0;
      if (!this.stopInProgress) {
        this.currentMode = null;
        this.options.dom.micTestStatus.textContent = "Idle";
      }
      this.setSignalState(false, false);
    } else {
      if (!this.startedAt) {
        this.startedAt = Date.now();
      }
      this.options.dom.micTestStatus.textContent =
        this.currentMode === "continuous" ? "Listening until stopped..." : "Listening...";
      this.setSignalState(false, true);
    }

    this.updateButtons();
  }

  async toggle(mode: MicTestMode) {
    if (this.active && this.currentMode === mode) {
      await this.stop();
      return;
    }

    if (!this.active) {
      await this.start(mode);
    }
  }

  async restartWithMode(mode: MicTestMode) {
    await this.stop();
    await this.start(mode);
  }

  getMode(): MicTestMode | null {
    return this.currentMode;
  }

  isActive(): boolean {
    return this.active;
  }

  cleanup() {
    this.clearAutoStop();
    if (this.waveRaf) {
      cancelAnimationFrame(this.waveRaf);
    }
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    this.cleanupPlayback();
  }

  populateMicrophoneOptions(devices: InputDeviceInfo[], preferredDeviceId: string) {
    const options: InputDeviceInfo[] = [
      {
        id: "default",
        name: "System default",
        isDefault: false,
      },
      ...devices,
    ];

    this.options.dom.microphoneSelect.innerHTML = "";
    for (const device of options) {
      const option = document.createElement("option");
      option.value = device.id;
      option.textContent = device.isDefault ? `${device.name} (default)` : device.name;
      this.options.dom.microphoneSelect.appendChild(option);
    }

    const preferredExists = options.some((device) => device.id === preferredDeviceId);
    this.options.dom.microphoneSelect.value = preferredExists ? preferredDeviceId : "default";
  }

  populateDefaultMicrophoneOption() {
    this.options.dom.microphoneSelect.innerHTML = "";
    const option = document.createElement("option");
    option.value = "default";
    option.textContent = "System default";
    this.options.dom.microphoneSelect.appendChild(option);
    this.options.dom.microphoneSelect.value = "default";
  }

  private updateButtons() {
    const timedActive = this.active && this.currentMode === "timed";
    const continuousActive = this.active && this.currentMode === "continuous";

    this.options.dom.micTestBtn.textContent = timedActive ? "Stop test" : "5s test";
    this.options.dom.continuousMicTestBtn.textContent = continuousActive
      ? "Stop test"
      : "Continuous test";
    this.options.dom.micTestBtn.disabled = continuousActive || this.stopInProgress;
    this.options.dom.continuousMicTestBtn.disabled = timedActive || this.stopInProgress;
  }

  private clearAutoStop() {
    if (this.autoStopTimer !== null) {
      window.clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
  }

  private setSignalState(isSignalDetected: boolean, isListening: boolean) {
    const statusText = this.options.dom.micSignalIndicator.querySelector(".status-text") as HTMLElement;
    this.options.dom.micSignalIndicator.className = "status-indicator";

    if (!isListening) {
      this.options.dom.micSignalIndicator.classList.add("disconnected");
      statusText.textContent = "No signal";
      return;
    }

    if (isSignalDetected) {
      this.options.dom.micSignalIndicator.classList.add("connected");
      statusText.textContent = "Signal detected";
    } else {
      this.options.dom.micSignalIndicator.classList.add("disconnected");
      statusText.textContent = "Listening";
    }
  }

  private async start(mode: MicTestMode) {
    const provider = this.options.getActiveProvider();
    const settings = this.options.getCurrentSettings();
    const apiKey = settings.providers[provider].apiKey.trim();
    if (!apiKey) {
      this.options.dom.micTestStatus.textContent = `${getProviderLabel(provider)} API key required`;
      this.options.dom.micTestTranscript.textContent = "Transcript: -";
      this.setSignalState(false, false);
      return;
    }

    const effectiveTypingMode = mode === "timed" ? "all_at_once" : "incremental";
    const sessionSettings: Settings = {
      ...settings,
      typingMode: effectiveTypingMode,
      sttProvider: provider,
    };

    const session = new LiveAudioSession<string | null>({
      provider,
      apiKey,
      language: this.options.dom.languageSelect.value || "auto",
      preferredModel:
        this.options.dom.liveModelSelect.value || settings.providers[provider].selectedModel,
      fallbackModels: settings.providers[provider].modelCache?.models ?? [],
      typingMode: effectiveTypingMode,
      enableTyping: false,
      textCommandSettings: sessionSettings,
      audioEventName: "mic-test-audio-chunk",
      startCommand: "start_mic_monitoring",
      startPayload: {
        deviceId: this.options.dom.microphoneSelect.value || "default",
        inputGain: this.options.getRecordingInputGain(),
        captureLimitSeconds: mode === "timed" ? MIC_TEST_DURATION_MS / 1000 : null,
      },
      stopCommand: "stop_mic_monitoring_with_recording",
      onTranscript: ({ displayText, isFinal }) => {
        if (mode === "timed" && !isFinal) {
          return;
        }

        if (displayText) {
          this.options.dom.micTestTranscript.textContent = `Transcript: ${displayText}`;
        } else if (isFinal) {
          this.options.dom.micTestTranscript.textContent = "Transcript: (No speech detected)";
        }
      },
      onStatus: (status, message) => {
        if (!this.active || this.stopInProgress) {
          return;
        }

        if (status === "connecting") {
          this.options.dom.micTestStatus.textContent = "Connecting...";
        } else if (status === "connected") {
          this.options.dom.micTestStatus.textContent =
            this.currentMode === "continuous" ? "Listening until stopped..." : "Listening...";
        } else if (status === "error") {
          this.options.dom.micTestStatus.textContent = message
            ? `Error: ${message}`
            : "Transcription error";
        } else if (status === "disconnected") {
          this.options.dom.micTestStatus.textContent = message
            ? `Disconnected: ${message}`
            : "Disconnected";
        }
      },
    });

    try {
      this.clearAutoStop();
      this.cleanupPlayback();
      this.active = true;
      this.currentMode = mode;
      this.session = session;
      this.startedAt = Date.now();
      this.options.dom.micTestStatus.textContent = "Connecting...";
      this.options.dom.micTestTranscript.textContent =
        mode === "timed"
          ? "Transcript: Waiting for final transcript..."
          : "Transcript: Listening for live transcript...";
      this.setSignalState(false, true);
      this.updateButtons();

      await session.start();
      this.options.debugLog(
        `Mic test started with ${getProviderLabel(provider)} model '${session.getActiveModel()}' in ${effectiveTypingMode} mode`,
        "INFO"
      );

      if (mode === "timed") {
        this.autoStopTimer = window.setTimeout(() => {
          if (this.active && this.currentMode === "timed") {
            void this.stop();
          }
        }, MIC_TEST_DURATION_MS);
      }
    } catch (err) {
      console.error("Failed to start mic test:", err);
      this.session = null;
      this.active = false;
      this.currentMode = null;
      this.options.dom.micTestStatus.textContent = "Mic test failed";
      this.options.dom.micTestTranscript.textContent = "Transcript: -";
      this.setSignalState(false, false);
      this.updateButtons();
    }
  }

  private async stop() {
    if (this.stopInProgress) {
      return;
    }

    this.stopInProgress = true;
    this.clearAutoStop();

    const session = this.session;
    let recordedWavBase64: string | null = null;
    let finalTranscript = "";
    try {
      if (session) {
        this.options.dom.micTestStatus.textContent = "Finalizing transcript...";
        const result = await session.stop();
        recordedWavBase64 = result.captureResult;
        finalTranscript = result.finalText;
      }
    } catch (err) {
      console.error("Failed to stop mic test:", err);
    } finally {
      this.session = null;
      this.active = false;
      this.currentMode = null;
      this.startedAt = 0;
      this.targetMicLevel = 0;
      this.options.dom.micTestStatus.textContent = "Idle";
      this.setSignalState(false, false);
      this.stopInProgress = false;
      this.updateButtons();
    }

    if (!recordedWavBase64) {
      this.options.dom.micTestStatus.textContent = "No audio captured";
      this.options.dom.micTestTranscript.textContent = finalTranscript
        ? `Transcript: ${finalTranscript}`
        : "Transcript: No audio captured";
      return;
    }

    if (finalTranscript) {
      this.options.debugLog(
        `Mic test transcript preview: "${finalTranscript.slice(0, 140)}${finalTranscript.length > 140 ? "..." : ""}"`,
        "INFO"
      );
      this.options.dom.micTestTranscript.textContent = `Transcript: ${finalTranscript}`;
    } else {
      this.options.debugLog("Mic test transcript is empty", "WARN");
      this.options.dom.micTestTranscript.textContent = "Transcript: (No speech detected)";
    }

    this.options.dom.micTestStatus.textContent = "Playing back...";
    const played = await this.playRecording(recordedWavBase64);
    this.options.dom.micTestStatus.textContent = played ? "Playback complete" : "Playback failed";
  }

  private async playRecording(wavBase64: string): Promise<boolean> {
    try {
      this.cleanupPlayback();

      const wavBytes = base64ToBytes(wavBase64);
      const blob = new Blob([wavBytes], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      this.lastPlaybackUrl = url;

      const audio = new Audio(url);
      this.lastAudio = audio;
      this.playbackActive = true;
      await audio.play();

      return await new Promise<boolean>((resolve) => {
        audio.addEventListener(
          "ended",
          () => {
            this.playbackActive = false;
            this.targetMicLevel = 0;
            resolve(true);
          },
          { once: true }
        );
        audio.addEventListener(
          "error",
          () => {
            this.playbackActive = false;
            this.targetMicLevel = 0;
            resolve(false);
          },
          { once: true }
        );
      });
    } catch (err) {
      this.playbackActive = false;
      this.targetMicLevel = 0;
      console.error("Failed to play mic test recording:", err);
      return false;
    }
  }

  private cleanupPlayback() {
    this.playbackActive = false;
    this.targetMicLevel = 0;
    if (this.lastAudio) {
      this.lastAudio.pause();
      this.lastAudio.src = "";
      this.lastAudio = null;
    }

    if (this.lastPlaybackUrl) {
      URL.revokeObjectURL(this.lastPlaybackUrl);
      this.lastPlaybackUrl = null;
    }
  }
}

export function getWaveToolButtonState(
  unlocked: boolean,
  waveformStyle: WaveformStyle,
  waveformColorScheme: WaveformColorScheme,
  getWaveformStyleLabel: (style: WaveformStyle) => string,
  getWaveformColorSchemeLabel: (scheme: WaveformColorScheme) => string
) {
  return {
    waveStyleHidden: !unlocked,
    waveColorHidden: !unlocked,
    waveStyleTitle: `Wave style: ${getWaveformStyleLabel(waveformStyle)}`,
    waveColorTitle: `Wave colors: ${getWaveformColorSchemeLabel(waveformColorScheme)}`,
  };
}
