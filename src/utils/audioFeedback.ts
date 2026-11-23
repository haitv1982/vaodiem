let sharedAudioCtx: AudioContext | null = null;
let cachedNoiseBuffer: AudioBuffer | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (cachedNoiseBuffer && cachedNoiseBuffer.sampleRate === ctx.sampleRate) {
    return cachedNoiseBuffer;
  }
  const length = Math.floor(ctx.sampleRate * 0.08);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  cachedNoiseBuffer = buffer;
  return buffer;
}

/**
 * Phát âm thanh mô phỏng tiếng màn trập chụp ảnh máy ảnh (gọn, sắc nét ~65ms)
 */
export function playShutterSound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const noiseBuffer = getNoiseBuffer(ctx);

  // Tiếng "tách" đầu màn trập mở
  const click1 = ctx.createBufferSource();
  click1.buffer = noiseBuffer;
  const filter1 = ctx.createBiquadFilter();
  filter1.type = 'bandpass';
  filter1.frequency.setValueAtTime(2800, now);
  filter1.Q.setValueAtTime(1.4, now);
  const gain1 = ctx.createGain();
  gain1.gain.setValueAtTime(0.35, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.025);
  click1.connect(filter1);
  filter1.connect(gain1);
  gain1.connect(ctx.destination);
  click1.start(now);
  click1.stop(now + 0.028);

  // Tiếng "cạch" màn trập đóng sau 28ms
  const t2 = now + 0.028;
  const click2 = ctx.createBufferSource();
  click2.buffer = noiseBuffer;
  const filter2 = ctx.createBiquadFilter();
  filter2.type = 'bandpass';
  filter2.frequency.setValueAtTime(1900, t2);
  filter2.Q.setValueAtTime(1.8, t2);
  const gain2 = ctx.createGain();
  gain2.gain.setValueAtTime(0.28, t2);
  gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.032);
  click2.connect(filter2);
  filter2.connect(gain2);
  gain2.connect(ctx.destination);
  click2.start(t2);
  click2.stop(t2 + 0.035);
}

export function playWarningBeep() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(340, now);
  osc.frequency.setValueAtTime(280, now + 0.07);
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.17);
}
