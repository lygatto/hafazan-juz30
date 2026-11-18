// Enjin semakan: bandingkan transkrip AI dengan teks Al-Quran.
//
// Dua peringkat:
//  1. PENJAJARAN — cari perkataan mana yang dibaca, menggunakan "rangka" huruf
//     (tanpa baris/alif/hamzah) dengan padanan kabur. Ini menentukan kedudukan
//     sahaja, tidak menentukan betul/salah.
//  2. PENILAIAN KETAT — setiap perkataan yang dijajarkan dibandingkan dengan
//     teks imla'i (gaya ejaan sama dengan output AI):
//       • huruf mesti tepat (termasuk huruf mad ا و ي)  → jika tidak: 'salah'
//       • baris mesti tepat (fathah/kasrah/dhammah/tanwin/syaddah),
//         kecuali baris huruf terakhir di tempat berhenti (waqaf) → jika tidak: 'baris'

const HARAKAT = /[ً-ْ]/;
const STRIP = /[ؐ-ًؚ-ٟۖ-ۭـٰ]/g;

function unify(w) {
  return w.replace(/[ٱأإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}

/** Rangka huruf untuk penjajaran (longgar). */
export function skeleton(text) {
  return unify(text).replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(STRIP, '')
    .replace(/[اء]/g, '').replace(/[^ء-ي]/g, '');
}

/** Huruf tepat (tanpa baris) untuk penilaian ketat. */
export function letters(text) {
  return unify(text).replace(STRIP, '').replace(/[^ء-ي]/g, '');
}

/** Senarai [huruf, baris] — sukun diabaikan; baris disusun supaya tertib tidak penting. */
function harakatSig(text) {
  const out = [];
  let cur = null;
  for (const ch of unify(text.replace(/ٰ/g, ''))) {
    if (ch >= 'ء' && ch <= 'ي') { if (cur) out.push(cur); cur = [ch, '']; }
    else if (cur && HARAKAT.test(ch) && ch !== 'ْ') cur[1] += ch;
  }
  if (cur) out.push(cur);
  return out.map(([c, h]) => c + [...h].sort().join(''));
}

/** Nilai satu perkataan: 'ok' | 'salah' | 'baris'. */
export function judge(expected, heard, atWaqf) {
  if (letters(expected) !== letters(heard)) return 'salah';
  if (!HARAKAT.test(heard)) return 'ok'; // AI tidak beri baris — tidak dapat dinilai
  const e = harakatSig(expected), h = harakatSig(heard);
  if (atWaqf) { e[e.length - 1] = e[e.length - 1]?.[0]; h[h.length - 1] = h[h.length - 1]?.[0]; }
  return e.join('|') === h.join('|') ? 'ok' : 'baris';
}

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

export function similarity(a, b) {
  if (a === b) return 1;
  const L = Math.max(a.length, b.length);
  return L ? 1 - lev(a, b) / L : 1;
}

const ALIGN = 0.6;   // keserupaan rangka minimum untuk dianggap "perkataan yang sama dicuba"
const R_MATCH = 3;   // ganjaran padanan (didarab keserupaan)
const P_DEL = 0.5;   // perkataan dijangka tidak dibaca (tertinggal)
const P_INS = 1;     // perkataan tambahan dalam transkrip
const P_SUB = 1.4;   // perkataan lain sama sekali
const MERGE = 0.85;  // keserupaan minimum untuk gabung/pecah perkataan

const PREFIX = 'أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ'.split(' ');

/** words: [{key, last}] — key = teks imla'i berbaris, last = perkataan terakhir ayat. */
export function buildSequence(words) {
  const keys = PREFIX.concat(words.map((w) => w.key));
  const last = PREFIX.map(() => true).concat(words.map((w) => !!w.last));
  return { keys, sk: keys.map(skeleton), last, offset: PREFIX.length, count: words.length };
}

/**
 * Jajarkan satu potongan transkrip (satu "nafas" bacaan).
 * cursorWord   : indeks perkataan seterusnya yang dijangka
 * lookbackWord : perkataan terawal yang boleh diulang tanpa penalti
 * Pulangkan { results: Map(word -> {type, heard}), nextCursor }
 * type: 'ok' | 'salah' | 'baris' | 'tertinggal'
 */
export function alignSegment(seq, transcript, cursorWord, lookbackWord) {
  const raw = transcript.split(/\s+/).filter((w) => skeleton(w));
  const H = raw.map(skeleton);
  if (!H.length || cursorWord >= seq.count) return { results: new Map(), nextCursor: cursorWord, hyp: raw };

  const start = cursorWord === 0 ? 0 : seq.offset + Math.max(0, lookbackWord); // isti'azah/basmalah hanya di awal surah
  const c0 = seq.offset + cursorWord - start;
  const end = Math.min(seq.sk.length, seq.offset + cursorWord + Math.round(H.length * 1.5) + 25);
  const E = seq.sk.slice(start, end);
  const n = H.length, m = E.length, W = m + 1;

  const S = new Float32Array((n + 1) * W).fill(-Infinity);
  const B = new Int8Array((n + 1) * W); // 0 mula,1 padan,2 sisip,3 tinggal,4 hyp2→1,5 exp2→1
  const SC = new Float32Array((n + 1) * W);
  for (let j = 0; j <= m; j++) { S[j] = j <= c0 ? 0 : -(j - c0) * P_DEL; B[j] = j <= c0 ? 0 : 3; }
  const set = (i, j, v, b, sc) => { const k = i * W + j; if (v > S[k]) { S[k] = v; B[k] = b; SC[k] = sc; } };

  for (let i = 1; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (j > 0) {
        // Padanan dinilai dahulu supaya ia menang jika skor seri
        const sim = similarity(H[i - 1], E[j - 1]);
        const pk = (i - 1) * W + j - 1, pb = B[pk];
        const chain = (pb === 1 || pb === 4 || pb === 5) && SC[pk] >= ALIGN ? 0.3 : 0; // utamakan padanan bersambung
        set(i, j, S[pk] + (sim >= ALIGN ? R_MATCH * sim + chain : -P_SUB), 1, sim >= ALIGN ? sim : 0);
        if (i >= 2) {
          const s2 = similarity(H[i - 2] + H[i - 1], E[j - 1]);
          if (s2 >= MERGE) set(i, j, S[(i - 2) * W + j - 1] + R_MATCH * s2, 4, s2);
        }
        if (j >= 2) {
          const s2 = similarity(H[i - 1], E[j - 2] + E[j - 1]);
          if (s2 >= MERGE) set(i, j, S[(i - 1) * W + j - 2] + R_MATCH * s2 + 0.5, 5, s2);
        }
        set(i, j, S[i * W + j - 1] - (j <= c0 ? 0 : P_DEL), 3, 0); // zon ulangan: tiada penalti
      }
      set(i, j, S[(i - 1) * W + j] - P_INS, 2, 0);
    }
  }
  let bestJ = 0, best = -Infinity; // akhiran percuma (seri: utamakan yang lebih jauh)
  for (let j = 0; j <= m; j++) if (S[n * W + j] >= best) { best = S[n * W + j]; bestJ = j; }

  // Jejak balik + penilaian ketat
  const status = new Array(m).fill(null);
  const key = (j) => seq.keys[start + j];
  const waqf = (j, hi) => seq.last[start + j] || hi === n; // hujung ayat atau murid berhenti
  let i = n, j = bestJ, aligned = 0;
  while (i > 0 || j > 0) {
    const k = i * W + j, b = B[k];
    if (b === 0) break;
    if (b === 1) {
      if (SC[k] >= ALIGN) { status[j - 1] = { type: judge(key(j - 1), raw[i - 1], waqf(j - 1, i)), heard: raw[i - 1], aligned: true }; aligned++; }
      else status[j - 1] = { type: 'salah', heard: raw[i - 1] };
      i--; j--;
    } else if (b === 2) i--;
    else if (b === 3) { status[j - 1] = { type: 'tertinggal' }; j--; }
    else if (b === 4) {
      const heard = raw[i - 2] + ' ' + raw[i - 1];
      status[j - 1] = { type: judge(key(j - 1), heard, waqf(j - 1, i)), heard, aligned: true }; aligned++; i -= 2; j--;
    } else if (b === 5) {
      const t = judge(key(j - 2) + ' ' + key(j - 1), raw[i - 1], waqf(j - 1, i));
      status[j - 1] = status[j - 2] = { type: t, heard: raw[i - 1], aligned: true }; aligned++; i--; j -= 2;
    }
  }

  const results = new Map();
  if (!aligned) return { results, nextCursor: cursorWord, hyp: raw, rejected: true }; // bising / tiada padanan
  // Jangan "melompat" melepasi jurang (≥2 perkataan tertinggal) jika selepasnya
  // kurang daripada 2 perkataan yang dijajarkan — kemungkinan besar padanan kebetulan.
  let endJ = bestJ;
  for (;;) {
    let k = endJ - 1, after = 0;
    while (k >= c0 && status[k]?.type !== 'tertinggal') { if (status[k]?.aligned) after++; k--; }
    if (k < c0) break;
    let gapStart = k;
    while (gapStart - 1 >= c0 && status[gapStart - 1]?.type === 'tertinggal') gapStart--;
    if (k - gapStart + 1 >= 2 && after < 2) endJ = gapStart;
    else break;
  }
  if (endJ <= c0) return { results, nextCursor: cursorWord, hyp: raw, rejected: true };
  const lastWord = start + endJ - 1 - seq.offset;
  for (let w = cursorWord; w <= lastWord; w++) {
    const st = status[seq.offset + w - start] || { type: 'tertinggal' };
    results.set(w, { type: st.type, heard: st.heard });
  }
  return { results, nextCursor: Math.max(cursorWord, lastWord + 1), hyp: raw };
}
