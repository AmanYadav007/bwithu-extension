let audioContext: AudioContext | null = null;

function getAudioContext() {
  audioContext ??= new AudioContext();
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

function tone(
  frequency: number,
  start: number,
  duration: number,
  gainValue: number,
  type: OscillatorType = "sine",
) {
  const context = getAudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(gainValue, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

export function playSpawnChime() {
  const context = getAudioContext();
  const now = context.currentTime;
  tone(523.25, now, 0.32, 0.035);
  tone(659.25, now + 0.09, 0.34, 0.028);
  tone(987.77, now + 0.19, 0.42, 0.022);
}

export function playClickPop() {
  const context = getAudioContext();
  const now = context.currentTime;
  tone(420, now, 0.07, 0.035, "triangle");
  tone(760, now + 0.035, 0.09, 0.025, "sine");
}

export function playTinySparkle() {
  const context = getAudioContext();
  const now = context.currentTime;
  tone(1180, now, 0.08, 0.018);
  tone(1568, now + 0.045, 0.1, 0.014);
}

export function playListenStart() {
  const context = getAudioContext();
  const now = context.currentTime;
  tone(392, now, 0.11, 0.02, "triangle");
  tone(587.33, now + 0.055, 0.16, 0.018);
}

export function playThinkingTick() {
  const context = getAudioContext();
  const now = context.currentTime;
  tone(740, now, 0.045, 0.012, "sine");
  tone(880, now + 0.05, 0.045, 0.01, "sine");
}

export function playHappyChirp() {
  const context = getAudioContext();
  const now = context.currentTime;
  tone(659.25, now, 0.08, 0.018, "triangle");
  tone(1046.5, now + 0.055, 0.12, 0.016);
}
