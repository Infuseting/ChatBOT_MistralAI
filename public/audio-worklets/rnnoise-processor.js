// Lightweight RNNoise AudioWorklet processor scaffold (public served file).
// This is a placeholder processor. Replace with a real rnnoise WASM-backed
// processor for production. It emits simple RMS-based VAD messages to the
// main thread so the app can react.
class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._frameSize = 480; // typical RNNoise frame size at 48kHz
    this._buffer = new Float32Array(this._frameSize);
    this._bufIndex = 0;
    this.port.postMessage({ type: 'ready' });
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channelData = input[0];
    for (let i = 0; i < channelData.length; i++) {
      this._buffer[this._bufIndex++] = channelData[i];
      if (this._bufIndex >= this._frameSize) {
        // Simple energy computation as a placeholder for RNNoise VAD output
        let sum = 0;
        for (let j = 0; j < this._frameSize; j++) {
          const v = this._buffer[j];
          sum += v * v;
        }
        const rms = Math.sqrt(sum / this._frameSize);
        this.port.postMessage({ type: 'vad', rms });
        this._bufIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);
