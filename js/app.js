import { buildSequence, alignSegment } from './align.js';
import { Recorder } from './recorder.js';

const $ = (id) => document.getElementById(id);
const AUDIO_BASE = 'https://everyayah.com/data/Husary_64kbps/';
const KEY = 'hafazan30:v1';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arNum = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[d]);
const pad3 = (n) => String(n).padStart(3, '0');

// ---------- Simpanan (dalam peranti sahaja) ----------
function loadStore() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
const store = Object.assign({ surahs: {}, review: {}, settings: {} }, loadStore());
store.surahs ||= {}; store.review ||= {}; store.settings ||= {};
function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch {} }

function surahStatus(n) {
  const s = store.surahs[n];
  if (!s) return '';
  if (s.full && s.best >= 90) return 'g';
  return 'y';
}

// ---------- Bentuk bintang 8 bucu ----------
function starPath(size = 40, outer = 19, inner = 15.2) {
  const c = size / 2, pts = [];
  for (let i = 0; i < 16; i++) {
    const r = i % 2 ? inner : outer, a = (Math.PI / 8) * i - Math.PI / 2;
    pts.push(`${(c + r * Math.cos(a)).toFixed(2)},${(c + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}
const STAR = `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="${starPath()}"/></svg>`;
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

// ---------- Tema ----------
const THEMES = ['auto', 'light', 'dark'];
const THEME_ICON = {
  auto: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
};
const THEME_LABEL = { auto: 'Tema: ikut peranti', light: 'Tema: cerah', dark: 'Tema: gelap' };
function applyTheme() {
  const t = store.settings.theme || 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  $('themeBtn').innerHTML = THEME_ICON[t];
  $('themeBtn').setAttribute('aria-label', THEME_LABEL[t]);
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]').content = dark ? '#0B2B23' : '#0F5D4A';
}
$('themeBtn').onclick = () => {
  const t = store.settings.theme || 'auto';
  store.settings.theme = THEMES[(THEMES.indexOf(t) + 1) % 3]; save(); applyTheme();
  toast(THEME_LABEL[store.settings.theme]);
};

// ---------- Toast ----------
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------- Enjin AI (Web Worker) ----------
const ai = { ready: false, loading: false, queue: [], busy: false, cb: new Map() };
const worker = new Worker(new URL('./asr-worker.js', import.meta.url), { type: 'module' });
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'progress') {
    const pct = Math.min(100, Math.round((m.loaded / m.total) * 100));
    $('modelBar').style.width = pct + '%';
    $('modelText').textContent = `Memuat turun… ${pct}% (${(m.loaded / 1e6).toFixed(0)} / ${(m.total / 1e6).toFixed(0)} MB)`;
    setStatus(`<span class="spin"></span>Memuat turun enjin AI… ${pct}%`, true);
  } else if (m.type === 'ready') {
    ai.ready = true; ai.loading = false;
    try { localStorage.setItem('hafazan30:model', '1'); } catch {}
    renderModelCard(); setStatus(session ? 'Sedia — tekan mikrofon untuk mula' : 'Sedia');
    $('micBtn').disabled = false;
  } else if (m.type === 'error') {
    ai.loading = false; renderModelCard(m.message);
    setStatus('Gagal memuat enjin AI. Semak sambungan internet.');
  } else if (m.type === 'result') {
    const cb = ai.cb.get(m.id); ai.cb.delete(m.id); ai.busy = false;
    cb && cb(m);
    pump();
  }
};
function loadModel() {
  if (ai.ready || ai.loading) return;
  ai.loading = true; renderModelCard(); worker.postMessage({ type: 'load' });
}
let reqId = 0;
function transcribe(audio, cb) { const id = ++reqId; ai.cb.set(id, cb); ai.queue.push({ id, audio }); pump(); }
function pump() {
  if (ai.busy || !ai.ready || !ai.queue.length) return;
  const { id, audio } = ai.queue.shift(); ai.busy = true;
  worker.postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
}

function renderModelCard(err) {
  const card = $('modelCard'), btn = $('modelBtn');
  card.classList.toggle('ready', ai.ready);
  $('modelBarWrap').classList.toggle('hidden', !ai.loading);
  if (ai.ready) {
    card.querySelector('.mc-icon').innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    $('modelTitle').textContent = 'Enjin AI sedia';
    $('modelText').textContent = 'Tersimpan dalam peranti ini dan boleh digunakan luar talian.';
    btn.classList.add('hidden');
  } else if (ai.loading) {
    $('modelTitle').textContent = 'Menyediakan enjin AI…';
    btn.disabled = true; btn.textContent = 'Sila tunggu';
  } else {
    $('modelTitle').textContent = err ? 'Muat turun gagal' : 'Muat turun enjin AI';
    if (err) $('modelText').textContent = 'Semak sambungan internet dan cuba lagi.';
    btn.disabled = false; btn.textContent = err ? 'Cuba lagi' : 'Muat turun';
  }
}
$('modelBtn').onclick = loadModel;

// ---------- Data ----------
let SURAHS = [];

// ---------- Laman utama ----------
function renderHome() {
  const list = $('surahList'); list.innerHTML = '';
  let g = 0, y = 0;
  for (const s of SURAHS) {
    const st = surahStatus(s.n); if (st === 'g') g++; else if (st === 'y') y++;
    const rec = store.surahs[s.n];
    const b = document.createElement('button');
    b.className = 'surah';
    b.innerHTML = `
      <div class="star">${STAR}<span>${s.n}</span></div>
      <div class="s-info"><div class="s-name">${s.ms}</div><div class="s-meta">${s.mean} · ${s.ayat.length} ayat</div></div>
      <div class="s-right"><div class="s-ar">${s.ar}</div>
        <div class="s-score ${st}">${st ? `<i class="dot ${st}"></i>` : ''}${rec?.best != null ? rec.best + '%' : rec ? 'Separa' : 'Belum cuba'}</div></div>`;
    b.onclick = () => openSurah(s.n, 1);
    list.appendChild(b);
  }
  $('hafazCount').textContent = g; $('cntG').textContent = g; $('cntY').textContent = y;
  $('hafazBar').style.width = (g / 37 * 100) + '%';
  renderReview();
}

function ayahHTML(s, a, bad) {
  const set = new Set(bad);
  return s.ayat[a - 1].map((w, k) => set.has(k) ? `<span class="bad">${w}</span>` : w).join(' ');
}

function renderReview() {
  const keys = Object.keys(store.review).sort((x, y) => {
    const [a1, b1] = x.split(':').map(Number), [a2, b2] = y.split(':').map(Number);
    return a1 - a2 || b1 - b2;
  });
  const badge = $('reviewCount'); badge.textContent = keys.length; badge.classList.toggle('zero', !keys.length);
  const box = $('reviewList'); box.innerHTML = '';
  if (!keys.length) {
    box.innerHTML = '<div class="empty"><span class="big">مَا شَاءَ ٱللَّهُ</span>Tiada ayat yang perlu diulang buat masa ini.<br>Ayat yang ditanda merah semasa latihan akan muncul di sini.</div>';
    return;
  }
  for (const k of keys) {
    const [n, a] = k.split(':').map(Number);
    const s = SURAHS.find((x) => x.n === n); if (!s) continue;
    const div = document.createElement('div'); div.className = 'review-item';
    div.innerHTML = `
      <div class="ri-head"><div class="ri-title">${s.ms} <span>· Ayat ${a}</span></div>
        <div class="ri-actions"><button class="chip-btn" data-play>${ICON_PLAY}Dengar</button><button class="chip-btn primary" data-go>Latih</button></div></div>
      <div class="ri-text" dir="rtl" lang="ar">${ayahHTML(s, a, store.review[k].bad)}</div>`;
    div.querySelector('[data-play]').onclick = (e) => playAyah(n, a, e.currentTarget);
    div.querySelector('[data-go]').onclick = () => openSurah(n, a);
    box.appendChild(div);
  }
}

document.querySelectorAll('.tab').forEach((t) => t.onclick = () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $('surahList').classList.toggle('hidden', t.dataset.tab !== 'surahs');
  $('reviewList').classList.toggle('hidden', t.dataset.tab !== 'review');
});

// ---------- Audio qari ----------
const player = new Audio();
let playingBtn = null;
function playAyah(n, a, btn) {
  if (playingBtn === btn && !player.paused) { player.pause(); return; }
  if (rec?.active) { stopListening(); toast('Mikrofon dihentikan semasa audio dimainkan'); }
  player.src = `${AUDIO_BASE}${pad3(n)}${pad3(a)}.mp3`;
  player.play().catch(() => toast('Audio memerlukan sambungan internet'));
  playingBtn?.classList.remove('playing');
  playingBtn = btn; btn?.classList.add('playing');
}
const clearPlaying = () => { playingBtn?.classList.remove('playing'); playingBtn = null; };
player.onended = clearPlaying; player.onpause = clearPlaying;

// ---------- Sesi latihan ----------
let session = null;
let rec = null;

function openSurah(n, startAyah = 1) {
  stopListening(false);
  const s = SURAHS.find((x) => x.n === n);
  const words = [], ayahStart = [];
  s.ayat.forEach((ayah, ai) => {
    ayahStart.push(words.length);
    ayah.forEach((t, k) => words.push({ text: t, key: s.keys[ai][k], ayah: ai + 1, k, last: k === ayah.length - 1 }));
  });
  const startWord = ayahStart[startAyah - 1];
  session = { s, words, ayahStart, startAyah, startWord, cursor: startWord, res: new Map(), seq: buildSequence(words), token: Symbol(), pending: 0, finishing: false };

  $('pName').textContent = s.ms; $('pAr').textContent = s.ar;
  $('pSub').textContent = `${s.mean} · ${s.ayat.length} ayat`;
  const sel = $('startAyah'); sel.innerHTML = s.ayat.map((_, i) => `<option value="${i + 1}">Ayat ${i + 1}</option>`).join('');
  sel.value = startAyah;

  const m = $('mushaf'); m.innerHTML = '';
  for (let a = startAyah; a <= s.ayat.length; a++) {
    const div = document.createElement('div'); div.className = 'ayah'; div.dataset.a = a;
    const base = ayahStart[a - 1];
    div.innerHTML = s.ayat[a - 1].map((t, k) => `<span class="w hid" data-i="${base + k}">${t}</span>`).join(' ') +
      ` <span class="amark">${STAR}<b style="font-family:var(--font-ar);font-size:.5em">${arNum(a)}</b></span>` +
      `<button class="play-btn" aria-label="Dengar ayat ${a}" data-a="${a}">${ICON_PLAY}</button>`;
    m.appendChild(div);
  }
  m.querySelectorAll('.play-btn').forEach((b) => b.onclick = () => playAyah(n, +b.dataset.a, b));
  m.onclick = (e) => {
    const w = e.target.closest('.w.bad'); if (!w) return;
    const r = session.res.get(+w.dataset.i);
    const heard = r?.heard ? ` — AI dengar: ${r.heard}` : '';
    toast(r?.type === 'tertinggal' ? 'Tertinggal — perkataan ini tidak dibaca'
      : r?.type === 'baris' ? 'Salah baris' + heard : 'Salah' + heard, 4000);
  };
  m.classList.toggle('show-text', !!store.settings.showText);
  $('showText').checked = !!store.settings.showText;
  markNext();
  $('hint').classList.remove('hidden');
  if (!ai.ready) { setStatus('Enjin AI belum sedia — tekan mikrofon untuk muat turun'); }
  else setStatus('Sedia — tekan mikrofon untuk mula');

  if (!$('practice').classList.contains('active')) {
    history.pushState({ p: 1 }, '');
    $('home').classList.remove('active'); $('practice').classList.add('active');
  }
  window.scrollTo(0, 0);
}

function markNext() {
  document.querySelectorAll('.w.next').forEach((x) => x.classList.remove('next'));
  const el = document.querySelector(`.w[data-i="${session.cursor}"]`);
  if (el) {
    el.classList.add('next');
    const r = el.getBoundingClientRect();
    if (r.bottom > innerHeight - 190 || r.top < 120) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function lookbackFor(sess) {
  if (sess.cursor <= sess.startWord) return sess.startWord;
  const prevAyah = sess.words[sess.cursor - 1].ayah;
  return Math.max(sess.startWord, sess.ayahStart[prevAyah - 1]);
}

function onSegment(audio) {
  const sess = session; if (!sess) return;
  sess.pending++; updateBusy();
  transcribe(audio, (m) => {
    sess.pending--;
    if (session !== sess) return;
    if (m.error) { toast('Ralat semasa menyemak: ' + m.error); updateBusy(); return; }
    applyTranscript(m.text);
    updateBusy(m.text);
    if (sess.cursor >= sess.words.length) { stopListening(); sess.finishing = true; }
    if (sess.finishing && sess.pending === 0) showSummary();
  });
}

function applyTranscript(text) {
  const sess = session;
  const r = alignSegment(sess.seq, text, sess.cursor, lookbackFor(sess));
  for (const [w, st] of r.results) {
    if (sess.res.has(w)) continue;
    sess.res.set(w, st);
    const el = document.querySelector(`.w[data-i="${w}"]`);
    if (el) { el.classList.remove('hid'); el.classList.add(st.type === 'ok' ? 'ok' : 'bad'); }
  }
  if (r.results.size) $('hint').classList.add('hidden');
  sess.cursor = r.nextCursor;
  markNext();
}

let heardTimer;
function updateBusy(heard) {
  if (!session) return;
  if (session.pending > 0) setStatus(`<span class="spin"></span>Menyemak bacaan…`, true);
  else if (heard != null) {
    const t = heard.trim();
    setStatus(t ? `AI dengar: <span dir="rtl" lang="ar" style="font-family:var(--font-ar);font-size:15px">${escapeHTML(t)}</span>` : 'Tidak jelas — cuba baca semula', true);
    clearTimeout(heardTimer);
    heardTimer = setTimeout(() => { if (session && session.pending === 0) setStatus(rec?.active ? 'Mendengar…' : 'Sedia'); }, 4000);
  }
}
const escapeHTML = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function setStatus(html, isHTML = false) { const el = $('status'); if (isHTML) el.innerHTML = html; else el.textContent = html; }

async function startListening() {
  if (!ai.ready) {
    loadModel();
    toast('Enjin AI sedang dimuat turun. Sila tunggu sehingga siap.');
    return;
  }
  if (session.cursor >= session.words.length) { toast('Surah telah selesai dibaca. Tekan "Ulang" untuk cuba lagi.'); return; }
  if (!player.paused) player.pause();
  rec = new Recorder({
    onSegment,
    onLevel: (v) => { $('micRing').style.transform = `scale(${1 + v * 0.35})`; },
    onSpeech: (on) => { if (session?.pending === 0 && rec?.active) setStatus(on ? 'Mendengar…' : 'Mendengar… (berhenti sekejap untuk disemak)'); },
  });
  try {
    await rec.start();
    document.body.classList.add('listening');
    $('micBtn').setAttribute('aria-label', 'Berhenti');
    setStatus('Mendengar… mulakan bacaan');
  } catch (e) {
    rec = null;
    toast(e?.name === 'NotAllowedError' ? 'Kebenaran mikrofon diperlukan. Benarkan dalam tetapan pelayar.' : 'Mikrofon tidak dapat dibuka: ' + (e?.message || e), 4000);
  }
}
function stopListening(flush = true) {
  if (rec?.active) rec.stop(flush);
  rec = null;
  document.body.classList.remove('listening');
  $('micRing').style.transform = '';
  $('micBtn').setAttribute('aria-label', 'Mula membaca');
  if (session && session.pending === 0) setStatus('Sedia');
}

$('micBtn').onclick = () => (rec?.active ? stopListening() : startListening());
$('resetBtn').onclick = () => openSurah(session.s.n, session.startAyah);
$('startAyah').onchange = (e) => openSurah(session.s.n, +e.target.value);
$('showText').onchange = (e) => {
  store.settings.showText = e.target.checked; save();
  $('mushaf').classList.toggle('show-text', e.target.checked);
};
$('doneBtn').onclick = () => {
  stopListening();
  session.finishing = true;
  if (session.pending > 0) { setStatus('<span class="spin"></span>Menyemak bacaan terakhir…', true); return; }
  showSummary();
};
function goHome() {
  stopListening(false); session = null; player.pause();
  $('sheet').classList.add('hidden');
  $('practice').classList.remove('active'); $('home').classList.add('active');
  renderHome(); window.scrollTo(0, 0);
}
$('backBtn').onclick = () => history.back();
window.addEventListener('popstate', () => { if ($('practice').classList.contains('active')) goHome(); });

// ---------- Ringkasan ----------
function showSummary() {
  const sess = session; sess.finishing = false;
  if (!sess.res.size) { toast('Belum ada bacaan yang disemak.'); return; }
  let ok = 0, salah = 0, skip = 0;
  for (const v of sess.res.values()) v.type === 'ok' ? ok++ : v.type === 'tertinggal' ? skip++ : salah++;
  const total = ok + salah + skip, pct = Math.round((ok / total) * 100);
  const full = sess.startWord === 0 && sess.cursor >= sess.words.length;
  const n = sess.s.n;

  const r = store.surahs[n] || { attempts: 0 };
  r.attempts++; r.last = Date.now();
  if (full) { r.full = true; r.best = Math.max(r.best ?? 0, pct); }
  store.surahs[n] = r;

  // Kemas kini senarai "Perlu Diulang"
  const touched = new Map();
  for (const [w, v] of sess.res) {
    const { ayah, k } = sess.words[w];
    if (!touched.has(ayah)) touched.set(ayah, { bad: [], seen: 0 });
    const t = touched.get(ayah); t.seen++; if (v.type !== 'ok') t.bad.push(k);
  }
  const badAyat = [];
  for (const [a, t] of touched) {
    const key = `${n}:${a}`;
    if (t.bad.length) { store.review[key] = { bad: t.bad, t: Date.now() }; badAyat.push([a, t.bad]); }
    else if (t.seen === sess.s.ayat[a - 1].length) delete store.review[key];
  }
  save();

  $('sumPct').textContent = pct + '%';
  const fg = $('ringFg');
  fg.style.stroke = pct >= 90 ? 'var(--green)' : pct >= 70 ? 'var(--yellow)' : 'var(--red)';
  fg.style.strokeDashoffset = 326.7;
  requestAnimationFrame(() => requestAnimationFrame(() => { fg.style.strokeDashoffset = 326.7 * (1 - pct / 100); }));
  $('sumTitle').textContent = pct >= 90 ? 'Masya-Allah!' : pct >= 70 ? 'Alhamdulillah' : 'Teruskan berusaha';
  let msg = pct >= 90 ? 'Hafazan yang sangat baik. Semoga dikekalkan!' : pct >= 70 ? 'Bagus! Sedikit lagi untuk sempurna.' : 'Ulang ayat bertanda merah, kemudian cuba lagi.';
  if (!full) msg += ' (Bacaan separa: baca keseluruhan surah dari ayat 1 untuk status Hafaz.)';
  $('sumMsg').textContent = msg;
  $('sOk').textContent = ok; $('sSalah').textContent = salah; $('sSkip').textContent = skip;

  const list = $('sumList'); list.innerHTML = '';
  $('sumListTitle').classList.toggle('hidden', !badAyat.length);
  for (const [a, bad] of badAyat.sort((x, y) => x[0] - y[0])) {
    const d = document.createElement('div'); d.className = 'sum-item';
    d.innerHTML = `<span class="num">Ayat ${a}</span><div class="ri-text" dir="rtl" lang="ar">${ayahHTML(sess.s, a, bad)}</div><button class="play-btn" aria-label="Dengar ayat ${a}">${ICON_PLAY}</button>`;
    d.querySelector('button').onclick = (e) => playAyah(n, a, e.currentTarget);
    list.appendChild(d);
  }
  $('sheet').classList.remove('hidden');
  setStatus('Selesai');
}
$('sumRetry').onclick = () => { $('sheet').classList.add('hidden'); openSurah(session.s.n, session.startAyah); };
$('sumHome').onclick = () => { $('sheet').classList.add('hidden'); history.back(); };
$('sheet').onclick = (e) => { if (e.target === $('sheet')) $('sheet').classList.add('hidden'); };

// ---------- Mula ----------
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
renderModelCard();
fetch('data/juz30.json').then((r) => r.json()).then((d) => { SURAHS = d; renderHome(); });
try { if (localStorage.getItem('hafazan30:model') === '1') loadModel(); } catch {}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
