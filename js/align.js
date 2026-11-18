// Enjin semakan: bandingkan transkrip AI dengan teks Al-Quran.
// Penjajaran peringkat PERKATAAN dengan padanan kabur (fuzzy), menyokong
// perkataan yang dipecah/digabung (cth. Uthmani "يَٰلَيْتَنِى" vs imla'i "يا ليتني").

const DIACRITICS = /[ؐ-ًؚ-ٟۖ-ۭـٰ]/g;

export function normalize(text) {
  return text
    .replace(/[ٱأإآ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(DIACRITICS, '')
    .replace(/[اء]/g, '') // alif & hamza dibuang: punca utama beza ejaan Uthmani
    .replace(/[^ء-ي]/g, '');
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

export const PASS = 0.6;   // keserupaan minimum untuk dikira betul
const R_MATCH = 3;          // ganjaran padanan (didarab keserupaan)
const P_DEL = 0.5;          // perkataan dijangka tidak dibaca (tertinggal)
const P_INS = 1;            // perkataan tambahan dalam transkrip
const P_SUB = 1.4;          // perkataan lain dibaca (salah)
const MERGE = 0.85;         // keserupaan minimum untuk gabung/pecah perkataan

const PREFIX = 'أعوذ بالله من الشيطان الرجيم بسم الله الرحمن الرحيم'.split(' ');

/** words: [{text}] semua perkataan surah. */
export function buildSequence(words) {
  const norm = PREFIX.map(normalize).concat(words.map(w => normalize(w.text)));
  return { norm, offset: PREFIX.length, count: words.length };
}

/**
 * Jajarkan satu potongan transkrip (satu "nafas" bacaan).
 * cursorWord   : indeks perkataan seterusnya yang dijangka
 * lookbackWord : perkataan terawal yang boleh diulang tanpa penalti
 * Pulangkan { results: Map(word -> {score, type}), nextCursor }
 * type: 'ok' | 'salah' | 'tertinggal'
 */
export function alignSegment(seq, transcript, cursorWord, lookbackWord) {
  const H = transcript.split(/\s+/).map(normalize).filter(Boolean);
  if (!H.length || cursorWord >= seq.count) return { results: new Map(), nextCursor: cursorWord, hyp: H };

  const start = cursorWord === 0 ? 0 : seq.offset + Math.max(0, lookbackWord); // awalan isti'azah/basmalah hanya di awal surah
  const c0 = seq.offset + cursorWord - start;
  const end = Math.min(seq.norm.length, seq.offset + cursorWord + Math.round(H.length * 1.5) + 25);
  const E = seq.norm.slice(start, end);
  const n = H.length, m = E.length, W = m + 1;

  const S = new Float32Array((n + 1) * W).fill(-Infinity);
  const B = new Int8Array((n + 1) * W); // 0 mula,1 padan,2 sisip,3 tinggal,4 hyp2→1,5 exp2→1
  const SC = new Float32Array((n + 1) * W); // keserupaan bagi langkah padan
  for (let j = 0; j <= m; j++) { S[j] = j <= c0 ? 0 : -(j - c0) * P_DEL; B[j] = j <= c0 ? 0 : 3; }
  const set = (i, j, v, b, sc) => { const k = i * W + j; if (v > S[k]) { S[k] = v; B[k] = b; SC[k] = sc; } };

  for (let i = 1; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (j > 0) {
        // Padanan dinilai dahulu supaya ia menang jika skor seri
        const sim = similarity(H[i - 1], E[j - 1]);
        // bonus kecil jika padanan bersambung dengan padanan sebelumnya (elak padanan "melompat")
        const pk = (i - 1) * W + j - 1, pb = B[pk];
        const chain = (pb === 1 || pb === 4 || pb === 5) && SC[pk] >= PASS ? 0.3 : 0;
        set(i, j, S[pk] + (sim >= PASS ? R_MATCH * sim + chain : -P_SUB), 1, sim >= PASS ? sim : 0);
        if (i >= 2) {
          const s2 = similarity(H[i - 2] + H[i - 1], E[j - 1]);
          if (s2 >= MERGE) set(i, j, S[(i - 2) * W + j - 1] + R_MATCH * s2, 4, s2);
        }
        if (j >= 2) {
          const s2 = similarity(H[i - 1], E[j - 2] + E[j - 1]);
          if (s2 >= MERGE) set(i, j, S[(i - 1) * W + j - 2] + R_MATCH * s2 + 0.5, 5, s2);
        }
        const free = j <= c0; // zon ulangan: tinggal tanpa penalti
        set(i, j, S[i * W + j - 1] - (free ? 0 : P_DEL), 3, 0);
      }
      set(i, j, S[(i - 1) * W + j] - P_INS, 2, 0);
    }
  }
  // Akhiran percuma — pilih hujung terbaik (seri: utamakan yang lebih jauh)
  let bestJ = 0, best = -Infinity;
  for (let j = 0; j <= m; j++) if (S[n * W + j] >= best) { best = S[n * W + j]; bestJ = j; }

  // Jejak balik
  const status = new Array(m).fill(null);
  let i = n, j = bestJ, matches = 0;
  while (i > 0 || j > 0) {
    const k = i * W + j, b = B[k];
    if (b === 0) break;
    if (b === 1) { status[j - 1] = SC[k] >= PASS ? { score: SC[k], type: 'ok' } : { score: 0, type: 'salah' }; if (SC[k] >= PASS) matches++; i--; j--; }
    else if (b === 2) i--;
    else if (b === 3) { status[j - 1] = { score: 0, type: 'tertinggal' }; j--; }
    else if (b === 4) { status[j - 1] = { score: SC[k], type: 'ok' }; matches++; i -= 2; j--; }
    else if (b === 5) { status[j - 1] = status[j - 2] = { score: SC[k], type: 'ok' }; matches++; i--; j -= 2; }
  }

  const results = new Map();
  if (!matches) return { results, nextCursor: cursorWord, hyp: H, rejected: true }; // bising / tiada padanan
  // Jangan "melompat" melepasi jurang (≥2 perkataan tertinggal) jika selepasnya
  // kurang daripada 2 perkataan yang padan — kemungkinan besar padanan kebetulan.
  let endJ = bestJ;
  for (;;) {
    let k = endJ - 1, okAfter = 0;
    while (k >= c0 && status[k]?.type !== 'tertinggal') { if (status[k]?.type === 'ok') okAfter++; k--; }
    if (k < c0) break;
    let gapStart = k;
    while (gapStart - 1 >= c0 && status[gapStart - 1]?.type === 'tertinggal') gapStart--;
    if (k - gapStart + 1 >= 2 && okAfter < 2) endJ = gapStart;
    else break;
  }
  if (endJ <= c0) return { results, nextCursor: cursorWord, hyp: H, rejected: true };
  const lastAbs = start + endJ - 1;
  const lastWord = lastAbs - seq.offset;
  for (let w = cursorWord; w <= lastWord; w++) {
    results.set(w, status[seq.offset + w - start] || { score: 0, type: 'tertinggal' });
  }
  return { results, nextCursor: Math.max(cursorWord, lastWord + 1), hyp: H };
}
