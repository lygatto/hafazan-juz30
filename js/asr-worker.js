// Pekerja latar belakang: jalankan model Whisper khas Al-Quran dalam pelayar.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';

// Model Whisper-base yang dilatih oleh Tarteel AI pada bacaan Al-Quran (format ONNX).
const MODEL_ID = 'aaqibhabib/whisper-base-ar-quran-onnx';
env.allowLocalModels = false;
env.useBrowserCache = true; // simpan model dalam peranti selepas muat turun pertama

let asr = null;
let loading = null;

function load() {
  if (loading) return loading;
  const files = {};
  loading = pipeline('automatic-speech-recognition', MODEL_ID, {
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    device: 'wasm',
    progress_callback: (p) => {
      if (p.status === 'progress' && p.total) {
        files[p.file] = { loaded: p.loaded, total: p.total };
        let loaded = 0, total = 0;
        for (const f of Object.values(files)) { loaded += f.loaded; total += f.total; }
        self.postMessage({ type: 'progress', loaded, total });
      }
    },
  }).then((p) => { asr = p; self.postMessage({ type: 'ready' }); return p; })
    .catch((e) => { loading = null; self.postMessage({ type: 'error', message: String(e?.message || e) }); });
  return loading;
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'load') { load(); return; }
  if (msg.type === 'transcribe') {
    try {
      await load();
      const t0 = performance.now();
      const out = await asr(msg.audio, { max_new_tokens: 200 });
      self.postMessage({ type: 'result', id: msg.id, text: out.text || '', ms: Math.round(performance.now() - t0) });
    } catch (err) {
      self.postMessage({ type: 'result', id: msg.id, text: '', error: String(err?.message || err) });
    }
  }
};
