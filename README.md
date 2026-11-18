# Hafazan Juz 'Amma: Semakan AI

Aplikasi web (PWA) untuk murid menyemak hafazan Juz 30 (An-Naba' hingga An-Nas) dengan suara.
AI mendengar bacaan dan menanda perkataan yang **salah** atau **tertinggal** dengan warna merah.

## Ciri-ciri
- **Semakan suara dengan AI**: model Whisper yang dilatih khas pada bacaan Al-Quran (Tarteel AI) berjalan **terus dalam pelayar**. Tiada pelayan, dan rakaman tidak dihantar ke mana-mana.
- **Mod hafazan**: teks disembunyikan dan didedahkan selepas dibaca. Suis **Tunjuk teks** tersedia untuk peringkat awal.
- **Tanda merah**: perkataan *salah* (perkataan lain dibaca) atau *tertinggal* (dilangkau). Sentuh perkataan merah untuk melihat jenis kesilapan.
- **Toleransi**: baris (harakat) dan beza ejaan Uthmani/imla'i diabaikan, mengulang bacaan tidak dikira salah, dan isti'azah serta basmalah diabaikan.
- **Ringkasan** di akhir surah: peratus ketepatan dan senarai ayat yang perlu diulang.
- **Kemajuan** disimpan dalam peranti: ⚪ belum cuba · 🟡 sedang dihafal · 🟢 hafaz (≥90% satu surah penuh).
- **Perlu Diulang**: semua ayat yang pernah ditanda merah, dengan butang dengar dan latih semula.
- **Audio rujukan**: Syeikh Mahmud Khalil Al-Husary (murattal) bagi setiap ayat.
- Tema Islamik moden, mod gelap, dan boleh dipasang ke skrin utama serta digunakan luar talian (kecuali audio qari).

## Batasan (Versi 1)
- **Tajwid tidak disemak** (mad, ghunnah, makhraj). Semakan hanya pada peringkat perkataan.
- Muat turun pertama lebih kurang **105MB** (enjin AI). Selepas itu enjin disimpan dalam peranti.
- Semakan berlaku selepas murid **berhenti sekejap** (kira-kira 1 saat) di hujung ayat, dan bukan secara serta-merta.
- Ketepatan bergantung pada kualiti mikrofon dan bunyi bising sekeliling.

## Struktur fail
```
index.html            Antara muka
css/styles.css        Gaya (tema cerah/gelap)
js/app.js             Logik aplikasi, simpanan kemajuan, ringkasan
js/align.js           Enjin semakan: penjajaran transkrip AI dengan teks Al-Quran
js/recorder.js        Mikrofon + pengesan jeda (VAD), potongan audio 16kHz
js/asr-worker.js      Web Worker yang menjalankan model AI (transformers.js)
data/juz30.json       Teks Rasm Uthmani Juz 30 (Tanzil), tanpa basmalah
sw.js                 Service worker (luar talian)
manifest.webmanifest  Tetapan PWA
icons/                Ikon aplikasi
```

## Hosting di GitHub Pages
1. Tolak (push) semua fail ke repo GitHub.
2. Di repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, pilih `main` dan `/ (root)`, kemudian **Save**.
3. Selepas 1–2 minit, aplikasi tersedia di `https://<nama-akaun>.github.io/<nama-repo>/`.

> Selepas mengemas kini fail, tukar `VERSION` dalam `sw.js` (cth. `v2`) supaya telefon murid mendapat versi terbaharu.

## Menjalankan secara lokal
```bash
python3 -m http.server 8080
```
Kemudian buka http://localhost:8080 (mikrofon hanya berfungsi melalui `localhost` atau `https`).

## Sumber & penghargaan
- Teks Al-Quran: [Tanzil.net](https://tanzil.net) (Rasm Uthmani), melalui api.alquran.cloud
- Model AI: `tarteel-ai/whisper-base-ar-quran` (Apache-2.0), versi ONNX `aaqibhabib/whisper-base-ar-quran-onnx`
- Audio: [everyayah.com](https://everyayah.com), Syeikh Mahmud Khalil Al-Husary
- Fon: Amiri Quran, Amiri, Plus Jakarta Sans (Google Fonts)
- Pustaka: [transformers.js](https://github.com/huggingface/transformers.js)

**Nota:** model ONNX dihos oleh pihak ketiga di Hugging Face. Untuk jaminan jangka panjang, salin model itu ke akaun Hugging Face sendiri dan tukar `MODEL_ID` dalam `js/asr-worker.js`.
