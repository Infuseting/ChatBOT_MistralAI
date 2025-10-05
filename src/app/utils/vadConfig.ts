// Centralized VAD configuration and helpers
export const VAD_CONFIG = {
  SILENCE_MS: 300,
  SESSION_END_SILENCE_MS: 700,
  MIN_RECORD_MS: 300,
  MIN_SPEECH_MS: 200,
  SHORT_GATE_MS: 120,
  EFFECTIVE_NOISE_GAP: 0.005,
  SHORT_GATE_FACTOR: 0.5,
  // After a message is sent, hold off re-triggering VAD for this many ms
  // This prevents immediate re-activation on mic restart which often
  // happens when the UI briefly stops/starts the mic or when residual
  // energy from the last utterance exists.
  POST_SEND_GRACE_MS: 800,
};

export function computeThresholds(noiseFloor: number) {
  // Simple thresholds derived from measured noiseFloor. These can be tuned.
  // enter: require a noticeable gap above noise; exit: slightly above noise.
  const enter = Math.max(0.001, noiseFloor + 0.018);
  const exit = Math.max(0.0005, noiseFloor + 0.008);
  return { enter, exit };
}
