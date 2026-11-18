// Perakam mikrofon + pengesan jeda (VAD) ringkas berasaskan tenaga suara.
// Setiap kali murid berhenti seketika, potongan audio 16kHz dihantar ke onSegment.

const TARGET_RATE = 16000;
const FRAME = 320;            // 20ms @16kHz
const SILENCE_END_MS = 850;   // jeda untuk tamatkan satu potongan
const MAX_SEG_S = 24;         // had Whisper ialah 30s
const MIN_VOICED_MS = 350;
const PREROLL_MS = 300;

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('tap', Tap);`;

export class Recorder {
  constructor({ onSegment, onLevel, onSpeech }) {
    this.onSegment = onSegment; this.onLevel = onLevel || (() => {}); this.onSpeech = onSpeech || (() => {});
    this.active = false;
  }

  async start() {
    // AudioContext dicipta dahulu (masih dalam sentuhan pengguna — perlu untuk iOS)
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) { this.ctx.close(); throw e; }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'tap');
    const mute = this.ctx.createGain(); mute.gain.value = 0;
    this.src.connect(this.node); this.node.connect(mute); mute.connect(this.ctx.destination);

    this.ratio = this.ctx.sampleRate / TARGET_RATE;
    this.resampleBuf = []; this.resamplePos = 0;
    this.frameBuf = new Float32Array(FRAME); this.frameLen = 0;
    this.noise = 0.004; this.calib = 0;
    this.inSpeech = false; this.seg = []; this.preroll = []; this.silentMs = 0; this.voicedMs = 0; this.loudRun = 0;
    this.node.port.onmessage = (e) => this._feed(e.data);
    this.active = true;
  }

  stop(flush = true) {
    if (!this.active) return;
    this.active = false;
    if (flush && this.inSpeech) this._emit();
    this.inSpeech = false; this.onSpeech(false);
    try { this.node.port.onmessage = null; this.src.disconnect(); this.node.disconnect(); } catch {}
    this.stream?.getTracks().forEach(t => t.stop());
    this.ctx?.close();
  }

  _feed(chunk) {
    // Turunkan kadar sampel ke 16kHz (purata linear)
    const r = this.ratio;
    for (let i = 0; i < chunk.length; i++) this.resampleBuf.push(chunk[i]);
    while (this.resamplePos + r < this.resampleBuf.length) {
      const a = Math.floor(this.resamplePos), b = Math.min(this.resampleBuf.length - 1, Math.floor(this.resamplePos + r));
      let s = 0; for (let k = a; k <= b; k++) s += this.resampleBuf[k];
      this._sample(s / (b - a + 1));
      this.resamplePos += r;
    }
    const drop = Math.floor(this.resamplePos);
    if (drop > 0) { this.resampleBuf.splice(0, drop); this.resamplePos -= drop; }
  }

  _sample(v) {
    this.frameBuf[this.frameLen++] = v;
    if (this.frameLen === FRAME) { this._frame(this.frameBuf.slice(0)); this.frameLen = 0; }
  }

  _frame(f) {
    let e = 0; for (let i = 0; i < f.length; i++) e += f[i] * f[i];
    const rms = Math.sqrt(e / f.length);
    this.onLevel(Math.min(1, rms * 12));
    if (this.calib < 15) { this.calib++; this.noise = Math.max(0.002, (this.noise * (this.calib - 1) + rms) / this.calib); }
    const thr = Math.max(0.01, this.noise * 3.2);
    const loud = rms > thr;

    if (!this.inSpeech) {
      if (!loud) this.noise = this.noise * 0.97 + rms * 0.03;
      this.preroll.push(f);
      if (this.preroll.length > PREROLL_MS / 20) this.preroll.shift();
      this.loudRun = loud ? this.loudRun + 1 : 0;
      if (this.loudRun >= 3) {
        this.inSpeech = true; this.onSpeech(true);
        this.seg = this.preroll.slice(); this.preroll = [];
        this.silentMs = 0; this.voicedMs = 60;
      }
      return;
    }
    this.seg.push(f);
    if (loud) { this.silentMs = 0; this.voicedMs += 20; } else this.silentMs += 20;

    if (this.silentMs >= SILENCE_END_MS) { this._emit(); return; }
    if (this.seg.length * 20 >= MAX_SEG_S * 1000) this._cutAtQuietest();
  }

  // Potongan terlalu panjang: potong pada titik paling senyap dalam 4s terakhir
  _cutAtQuietest() {
    const look = 200; // 4s
    let best = this.seg.length - 1, bestE = Infinity;
    for (let i = this.seg.length - look; i < this.seg.length - 5; i++) {
      let e = 0; for (let k = 0; k < 5; k++) { const fr = this.seg[i + k]; for (let j = 0; j < fr.length; j += 4) e += fr[j] * fr[j]; }
      if (e < bestE) { bestE = e; best = i + 2; }
    }
    const rest = this.seg.slice(best);
    this.seg = this.seg.slice(0, best);
    this._emit(true);
    this.inSpeech = true; this.seg = rest; this.voicedMs = rest.length * 20; this.silentMs = 0;
  }

  _emit(keepSpeaking = false) {
    const frames = this.seg; this.seg = [];
    if (!keepSpeaking) { this.inSpeech = false; this.onSpeech(false); }
    if (this.voicedMs < MIN_VOICED_MS) return;
    const out = new Float32Array(frames.length * FRAME);
    frames.forEach((fr, i) => out.set(fr, i * FRAME));
    // Normalisasi kekuatan supaya suara perlahan pun jelas kepada model
    let peak = 0; for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
    if (peak > 0 && peak < 0.5) { const g = 0.5 / peak; for (let i = 0; i < out.length; i++) out[i] *= g; }
    this.onSegment(out);
  }
}
