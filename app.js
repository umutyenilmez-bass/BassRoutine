'use strict';

// E-Tablo entegrasyonu için varsayılan Apps Script Web Uygulaması URL'si
// Buraya kopyaladığınız URL'yi yazarsanız, tüm cihazlarda otomatik olarak eşleşir.
const DEFAULT_SYNC_URL = '';

// ════════════════════════════════════════════
//  NAVİGASYON
// ════════════════════════════════════════════
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    item.classList.add('active');
    const t = document.getElementById('section-' + item.dataset.section);
    if (t) t.classList.add('active');
    saveState('lastSection', item.dataset.section);
  });
});

// ════════════════════════════════════════════
//  WEB AUDIO METRONOM
// ════════════════════════════════════════════
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

let metroBpm      = 80;
let metroRunning  = false;
let metroNextTime = 0;
let metroBeat     = 0;
let metroSchedId  = null;
let metroAnimId   = null;
let scheduledBeats = [];

function metroTick(time, beat) {
  const ctx  = getAudioCtx();
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = beat === 0 ? 1100 : 750;
  gain.gain.setValueAtTime(beat === 0 ? 0.8 : 0.45, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
  osc.start(time);
  osc.stop(time + 0.06);
  scheduledBeats.push({ time, beat });
}

function scheduleMetro() {
  const ctx = getAudioCtx();
  const spb = 60 / metroBpm;
  while (metroNextTime < ctx.currentTime + 0.12) {
    metroTick(metroNextTime, metroBeat);
    metroNextTime += spb;
    metroBeat = (metroBeat + 1) % 4;
  }
  metroSchedId = setTimeout(scheduleMetro, 25);
}

function animateBeats() {
  if (audioCtx) {
    const now = audioCtx.currentTime;
    while (scheduledBeats.length && scheduledBeats[0].time < now - 0.05) {
      const b = scheduledBeats.shift();
      document.querySelectorAll('.beat-dot').forEach(d => d.classList.remove('active', 'accent'));
      const dot = document.getElementById('beat-dot-' + ((b.beat % 4) + 1));
      if (dot) dot.classList.add(b.beat === 0 ? 'accent' : 'active');
    }
  }
  metroAnimId = requestAnimationFrame(animateBeats);
}

function startMetro() {
  if (metroRunning) return;
  getAudioCtx();
  metroRunning  = true;
  metroBeat     = 0;
  metroNextTime = audioCtx.currentTime + 0.05;
  scheduledBeats = [];
  scheduleMetro();
  animateBeats();
  const btn = document.getElementById('metro-toggle');
  btn.textContent = 'Durdur';
  btn.classList.add('running');
}

function stopMetro() {
  if (!metroRunning) return;
  metroRunning = false;
  clearTimeout(metroSchedId);
  cancelAnimationFrame(metroAnimId);
  document.querySelectorAll('.beat-dot').forEach(d => d.classList.remove('active', 'accent'));
  const btn = document.getElementById('metro-toggle');
  btn.textContent = 'Başlat';
  btn.classList.remove('running');
}

document.getElementById('metro-toggle').addEventListener('click', () => {
  metroRunning ? stopMetro() : startMetro();
});
document.getElementById('metro-plus').addEventListener('click', () => {
  metroBpm = Math.min(240, metroBpm + 1);
  document.getElementById('bpm-input').value = metroBpm;
  if (metroRunning) { stopMetro(); startMetro(); }
});
document.getElementById('metro-minus').addEventListener('click', () => {
  metroBpm = Math.max(40, metroBpm - 1);
  document.getElementById('bpm-input').value = metroBpm;
  if (metroRunning) { stopMetro(); startMetro(); }
});
document.getElementById('bpm-input').addEventListener('change', function () {
  let v = parseInt(this.value, 10);
  if (isNaN(v)) v = 80;
  metroBpm = Math.min(240, Math.max(40, v));
  this.value = metroBpm;
  if (metroRunning) { stopMetro(); startMetro(); }
});

// Tap Tempo
let tapTimes = [];
document.getElementById('tap-btn').addEventListener('click', () => {
  const now = Date.now();
  tapTimes.push(now);
  if (tapTimes.length > 6) tapTimes.shift();
  if (tapTimes.length > 1) {
    const diffs = [];
    for (let i = 1; i < tapTimes.length; i++) diffs.push(tapTimes[i] - tapTimes[i-1]);
    const avg = diffs.reduce((a,b) => a+b, 0) / diffs.length;
    metroBpm = Math.min(240, Math.max(40, Math.round(60000 / avg)));
    document.getElementById('bpm-input').value = metroBpm;
    if (metroRunning) { stopMetro(); startMetro(); }
  }
  const btn = document.getElementById('tap-btn');
  btn.classList.add('tapped');
  setTimeout(() => btn.classList.remove('tapped'), 140);
  clearTimeout(tapTimes._t);
  tapTimes._t = setTimeout(() => { tapTimes = []; }, 2000);
});

// ════════════════════════════════════════════
//  GERİ SAYIM TİMERLARI
// ════════════════════════════════════════════
// Her timer: { durationMs, remainingMs, startedAt, interval }
const timers = {};
const PRESETS = [5, 10, 15, 20, 30]; // dakika
const DEFAULT_MIN = 5;

function getTimer(id) {
  if (!timers[id]) {
    timers[id] = {
      durationMs:  DEFAULT_MIN * 60 * 1000,
      remainingMs: DEFAULT_MIN * 60 * 1000,
      startedAt:   null,
      interval:    null,
    };
  }
  return timers[id];
}

function formatCountdown(ms) {
  if (ms <= 0) return '00:00';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function swStart(id) {
  const t = getTimer(id);
  if (t.interval) return;           // zaten çalışıyor
  if (t.remainingMs <= 0) return;   // bitti, önce sıfırla

  t.startedAt = Date.now();
  t.interval = setInterval(() => {
    const elapsed = Date.now() - t.startedAt;
    t.remainingMs = Math.max(0, t.durationMs - elapsed);

    const el = document.getElementById('sw-display-' + id);
    if (el) el.textContent = formatCountdown(t.remainingMs);

    updateTotalElapsed();

    if (t.remainingMs <= 0) {
      clearInterval(t.interval);
      t.interval = null;
      onTimerDone(id);
    }
  }, 200);
}

function swStop(id) {
  const t = getTimer(id);
  if (!t.interval) return;
  // Kalan süreyi hesapla ve kaydet
  const elapsed = Date.now() - t.startedAt;
  t.durationMs  = Math.max(0, t.remainingMs);  // sıradaki start buradan devam eder
  clearInterval(t.interval);
  t.interval = null;
}

function swReset(id) {
  const t = getTimer(id);
  clearInterval(t.interval);
  t.interval = null;
  // Seçili süreye geri dön
  const card = document.getElementById('sw-card-' + id);
  const activeBtn = card?.querySelector('.dur-btn.active');
  const min = activeBtn ? parseInt(activeBtn.dataset.min, 10) : DEFAULT_MIN;
  t.durationMs  = min * 60 * 1000;
  t.remainingMs = t.durationMs;
  t.startedAt   = null;
  const el = document.getElementById('sw-display-' + id);
  if (el) {
    el.textContent = formatCountdown(t.remainingMs);
    el.classList.remove('done');
  }
}

function setDur(id, min, btn) {
  // Diğer butonların aktifliğini kaldır
  const card = document.getElementById('sw-card-' + id);
  card?.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Timer'ı yeni süreye ayarla (çalışıyorsa durdur)
  const t = getTimer(id);
  clearInterval(t.interval);
  t.interval    = null;
  t.durationMs  = min * 60 * 1000;
  t.remainingMs = t.durationMs;
  t.startedAt   = null;

  const el = document.getElementById('sw-display-' + id);
  if (el) {
    el.textContent = formatCountdown(t.remainingMs);
    el.classList.remove('done');
  }
}

function onTimerDone(id) {
  const el = document.getElementById('sw-display-' + id);
  if (el) {
    el.textContent = '00:00';
    el.classList.add('done');
    // Animasyon bittikten sonra kaldır
    setTimeout(() => el.classList.remove('done'), 2000);
  }
  playChime();
}

// Toplam çalışılan süreyi hesapla (sidebar)
function updateTotalElapsed() {
  let total = 0;
  Object.values(timers).forEach(t => {
    if (t.startedAt) {
      // çalışıyor: başlangıçta belirlenen süre - kalan
      total += t.durationMs - t.remainingMs;
    }
  });
  const el = document.getElementById('total-session-time');
  if (el) {
    const m = Math.floor(total / 60000);
    const s = Math.floor((total % 60000) / 1000);
    el.textContent = `${m}:${String(s).padStart(2,'0')}`;
  }
}

// ════════════════════════════════════════════
//  ÇAN SESİ (hoş, yorucu olmayan)
// ════════════════════════════════════════════
function playChime() {
  try {
    const ctx = getAudioCtx();
    // C5 – E5 – G5 – C6 artan arpej
    const notes = [
      { freq: 523.25, delay: 0,    dur: 1.8 },
      { freq: 659.25, delay: 0.18, dur: 1.6 },
      { freq: 783.99, delay: 0.36, dur: 1.4 },
      { freq: 1046.5, delay: 0.54, dur: 1.2 },
    ];
    notes.forEach(({ freq, delay, dur }) => {
      const t    = ctx.currentTime + delay;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      // Yumuşak zarf: hızlı attack, yavaş decay
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    });
  } catch(e) {}
}

// ════════════════════════════════════════════
//  SW-CARD OLUŞTURUCU (tüm bölümler için)
// ════════════════════════════════════════════
const SW_IDS = ['bona','isinma','bos-teller','gam','ders','master','slap','repertuar','sogutma','analiz'];

function buildSwCards() {
  SW_IDS.forEach(id => {
    const el = document.getElementById('sw-card-' + id);
    if (!el) return;

    const presetBtns = PRESETS.map((min, i) =>
      `<button class="dur-btn${i === 0 ? ' active' : ''}" data-min="${min}" onclick="setDur('${id}',${min},this)">${min}</button>`
    ).join('');

    el.innerHTML = `
      <div class="dur-label">dakika</div>
      <div class="dur-grid">${presetBtns}</div>
      <div class="sw-display" id="sw-display-${id}">${formatCountdown(DEFAULT_MIN * 60 * 1000)}</div>
      <div class="sw-controls">
        <button class="sw-btn" onclick="swStart('${id}')">▶</button>
        <button class="sw-btn" onclick="swStop('${id}')">⏸</button>
        <button class="sw-btn" onclick="swReset('${id}')">↺</button>
      </div>
    `;
  });
}

// ════════════════════════════════════════════
//  ZENGİN METİN EDİTÖRÜ — TOOLBAR
// ════════════════════════════════════════════
document.addEventListener('mousedown', e => {
  const btn = e.target.closest('.tb-btn[data-cmd]');
  if (!btn) return;
  const editorCard = btn.closest('.editor-card');
  const editor = editorCard?.querySelector('.rich-editor');
  if (!editor) return;
  e.preventDefault();
  editor.focus();
  const cmd = btn.dataset.cmd;
  const val = btn.dataset.val || null;
  document.execCommand(cmd, false, val);
  updateToolbarStates(btn.closest('.editor-toolbar'));
});

document.addEventListener('selectionchange', () => {
  const editor = document.activeElement;
  if (!editor?.classList.contains('rich-editor')) return;
  const toolbar = editor.closest('.editor-card')?.querySelector('.editor-toolbar');
  if (toolbar) updateToolbarStates(toolbar);
});

function updateToolbarStates(toolbar) {
  if (!toolbar) return;
  ['bold','italic','underline','strikeThrough','insertUnorderedList','insertOrderedList'].forEach(cmd => {
    const btn = toolbar.querySelector(`[data-cmd="${cmd}"]`);
    if (btn) {
      try { btn.classList.toggle('active', document.queryCommandState(cmd)); } catch(e) {}
    }
  });
}

function clearEditor(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.innerHTML.trim() && !confirm('Not alanı temizlensin mi?')) return;
  el.innerHTML = '';
  saveEditorNote(id.replace('editor-', ''), el);
}

// ════════════════════════════════════════════
//  NOT KAYDETME
// ════════════════════════════════════════════
function saveEditorNote(key, el) {
  saveState('enote-' + key, el.innerHTML);
}

function loadEditorNote(key) {
  return loadState('enote-' + key) || '';
}

// ════════════════════════════════════════════
//  GAM — 24 TON
// ════════════════════════════════════════════
const ALL_24_KEYS = [
  { tr:'Do',   type:'Majör', notes:['Do','Re','Mi','Fa','Sol','La','Si'] },
  { tr:'Sol',  type:'Majör', notes:['Sol','La','Si','Do','Re','Mi','Fa#'] },
  { tr:'Re',   type:'Majör', notes:['Re','Mi','Fa#','Sol','La','Si','Do#'] },
  { tr:'La',   type:'Majör', notes:['La','Si','Do#','Re','Mi','Fa#','Sol#'] },
  { tr:'Mi',   type:'Majör', notes:['Mi','Fa#','Sol#','La','Si','Do#','Re#'] },
  { tr:'Si',   type:'Majör', notes:['Si','Do#','Re#','Mi','Fa#','Sol#','La#'] },
  { tr:'Fa#',  type:'Majör', notes:['Fa#','Sol#','La#','Si','Do#','Re#','Mi#'] },
  { tr:'Re♭',  type:'Majör', notes:['Re♭','Mi♭','Fa','Sol♭','La♭','Si♭','Do'] },
  { tr:'La♭',  type:'Majör', notes:['La♭','Si♭','Do','Re♭','Mi♭','Fa','Sol'] },
  { tr:'Mi♭',  type:'Majör', notes:['Mi♭','Fa','Sol','La♭','Si♭','Do','Re'] },
  { tr:'Si♭',  type:'Majör', notes:['Si♭','Do','Re','Mi♭','Fa','Sol','La'] },
  { tr:'Fa',   type:'Majör', notes:['Fa','Sol','La','Si♭','Do','Re','Mi'] },
  { tr:'La',   type:'Minör', notes:['La','Si','Do','Re','Mi','Fa','Sol'] },
  { tr:'Mi',   type:'Minör', notes:['Mi','Fa#','Sol','La','Si','Do','Re'] },
  { tr:'Si',   type:'Minör', notes:['Si','Do#','Re','Mi','Fa#','Sol','La'] },
  { tr:'Fa#',  type:'Minör', notes:['Fa#','Sol#','La','Si','Do#','Re','Mi'] },
  { tr:'Do#',  type:'Minör', notes:['Do#','Re#','Mi','Fa#','Sol#','La','Si'] },
  { tr:'Sol#', type:'Minör', notes:['Sol#','La#','Si','Do#','Re#','Mi','Fa#'] },
  { tr:'Re#',  type:'Minör', notes:['Re#','Mi#','Fa#','Sol#','La#','Si','Do#'] },
  { tr:'Si♭',  type:'Minör', notes:['Si♭','Do','Re♭','Mi♭','Fa','Sol♭','La♭'] },
  { tr:'Fa',   type:'Minör', notes:['Fa','Sol','La♭','Si♭','Do','Re♭','Mi♭'] },
  { tr:'Do',   type:'Minör', notes:['Do','Re','Mi♭','Fa','Sol','La♭','Si♭'] },
  { tr:'Sol',  type:'Minör', notes:['Sol','La','Si♭','Do','Re','Mi♭','Fa'] },
  { tr:'Re',   type:'Minör', notes:['Re','Mi','Fa','Sol','La','Si♭','Do'] },
];

let gamQueue   = [];
let gamShown   = 0;
let gamCurrent = null;

function buildGamQueue() {
  gamQueue = ALL_24_KEYS.map((_,i) => i);
  for (let i = gamQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [gamQueue[i], gamQueue[j]] = [gamQueue[j], gamQueue[i]];
  }
  gamShown = 0;
  saveState('gamQueue', gamQueue);
  saveState('gamShown', gamShown);
}

function resetGamQueue() {
  buildGamQueue();
  updateGamUI();
  const lbl = document.getElementById('gam-queue-label');
  if (lbl) lbl.textContent = 'Sıra sıfırlandı';
  setTimeout(updateGamStatusLabel, 1500);
}

function updateGamStatusLabel() {
  const lbl = document.getElementById('gam-queue-label');
  if (!lbl) return;
  const rem = 24 - gamShown;
  lbl.textContent = rem === 0
    ? '24 tonun tamamı gösterildi — sıfırla'
    : `${rem} ton kaldı (${gamShown}/24)`;
}

function updateGamUI() {
  updateGamStatusLabel();
  const badge = document.getElementById('gam-counter');
  if (badge) badge.textContent = `${gamShown}/24`;
  const dotsEl = document.getElementById('gam-queue-dots');
  if (!dotsEl) return;
  dotsEl.innerHTML = '';
  for (let i = 0; i < 24; i++) {
    const d = document.createElement('div');
    d.className = 'queue-dot' + (i < gamShown ? ' done' : '');
    dotsEl.appendChild(d);
  }
}

function suggestScale() {
  if (gamShown >= gamQueue.length) buildGamQueue();
  const key = ALL_24_KEYS[gamQueue[gamShown]];
  gamShown++;
  gamCurrent = key;
  saveState('gamShown', gamShown);
  saveState('gamCurrent', gamCurrent);
  updateGamUI();

  // Sadece ad + tür göster
  document.getElementById('scale-result-name').textContent = key.tr;
  document.getElementById('scale-result-type').textContent = key.type;
  document.getElementById('scale-result').style.display = 'flex';

  renderAllKeysGrid();
}

function renderAllKeysGrid() {
  const grid = document.getElementById('all-keys-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const shown = new Set(gamQueue.slice(0, gamShown));
  ALL_24_KEYS.forEach((key, i) => {
    const isCur = gamCurrent && gamCurrent.tr === key.tr && gamCurrent.type === key.type;
    const cell = document.createElement('div');
    cell.className = 'key-cell' + (shown.has(i) ? ' done' : '') + (isCur ? ' current' : '');
    cell.title = `${key.tr} ${key.type}`;
    cell.innerHTML = `<span class="key-cell-name">${key.tr}</span><span class="key-cell-type">${key.type === 'Majör' ? 'maj' : 'min'}</span>`;
    grid.appendChild(cell);
  });
}

// ════════════════════════════════════════════
//  LOCAL STORAGE
// ════════════════════════════════════════════
function saveState(key, val) {
  try { localStorage.setItem('BR_' + key, JSON.stringify(val)); } catch(e) {}
}

function loadState(key) {
  try {
    const v = localStorage.getItem('BR_' + key);
    return v ? JSON.parse(v) : null;
  } catch(e) { return null; }
}

// ════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

  // 1) Geri sayım kartlarını oluştur
  buildSwCards();

  // 2) Editör içeriklerini yükle
  SW_IDS.forEach(id => {
    const el = document.getElementById('editor-' + id);
    if (el) {
      const saved = loadEditorNote(id);
      if (saved) el.innerHTML = saved;
    }
  });

  // 3) Gam kuyruğu
  const sq = loadState('gamQueue');
  const ss = loadState('gamShown');
  const sc = loadState('gamCurrent');
  if (sq && sq.length === 24) {
    gamQueue   = sq;
    gamShown   = ss || 0;
    gamCurrent = sc || null;
  } else {
    buildGamQueue();
  }
  updateGamUI();
  renderAllKeysGrid();

  // 4) Son açık bölüm
  const last = loadState('lastSection');
  if (last) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const t = document.getElementById('section-' + last);
    const n = document.querySelector(`.nav-item[data-section="${last}"]`);
    if (t) t.classList.add('active');
    if (n) n.classList.add('active');
  }

  // 5) Umut Gig - Bulut ve Yerel Veri Yönetimi
  initUmutGigs();
});

// ════════════════════════════════════════════
//  UMUT GIG - BULUT VE YEREL VERİ YÖNETİMİ
// ════════════════════════════════════════════
function initUmutGigs() {
  const urlInput = document.getElementById('cloud-url-input');
  const statusMsg = document.getElementById('cloud-status-msg');
  const saveBtn = document.getElementById('cloud-save-btn');
  const loadBtn = document.getElementById('cloud-load-btn');
  
  if (!urlInput) return;

  const savedUrl = loadState('sync_url') || DEFAULT_SYNC_URL;
  urlInput.value = savedUrl;

  // Durumu güncelle
  updateCloudStatus();

  // URL girdisi değiştiğinde kaydet
  urlInput.addEventListener('input', () => {
    saveState('sync_url', urlInput.value.trim());
    updateCloudStatus();
  });

  // Yerel verileri yükle
  const savedGigs = loadState('umut_gigs') || {};
  document.querySelectorAll('.gig-input').forEach(input => {
    const day = input.dataset.day;
    if (day && input.id !== 'cloud-url-input') {
      const type = input.classList.contains('gig-job') ? 'job' : 'outfit';
      if (savedGigs[day] && savedGigs[day][type] !== undefined) {
        input.value = savedGigs[day][type];
      }
    }
  });

  // Yerel veri değişikliklerini otomatik kaydet
  document.querySelectorAll('.gig-input').forEach(input => {
    if (input.id === 'cloud-url-input') return;
    input.addEventListener('input', () => {
      const day = input.dataset.day;
      if (day) {
        const type = input.classList.contains('gig-job') ? 'job' : 'outfit';
        const gigs = loadState('umut_gigs') || {};
        if (!gigs[day]) gigs[day] = {};
        gigs[day][type] = input.value;
        saveState('umut_gigs', gigs);
      }
    });
  });

  // Buton dinleyicileri
  saveBtn.addEventListener('click', saveGigsToCloud);
  loadBtn.addEventListener('click', () => loadGigsFromCloud(false));

  // Eğer URL tanımlıysa sayfa açılışında veriyi otomatik çek
  if (savedUrl) {
    loadGigsFromCloud(true);
  }
}

function updateCloudStatus() {
  const urlInput = document.getElementById('cloud-url-input');
  const statusMsg = document.getElementById('cloud-status-msg');
  if (!statusMsg) return;
  const url = urlInput.value.trim();
  if (url) {
    statusMsg.textContent = 'Bulut bağlantısı hazır. Senkronize etmek için aşağıdaki butonları kullanın.';
    statusMsg.className = 'cloud-status-text';
  } else {
    statusMsg.textContent = 'Bulut bağlantısı aktif değil. Verileriniz yerel olarak tarayıcıya kaydedilmektedir.';
    statusMsg.className = 'cloud-status-text';
  }
}

async function saveGigsToCloud() {
  const urlInput = document.getElementById('cloud-url-input');
  const statusMsg = document.getElementById('cloud-status-msg');
  const saveBtn = document.getElementById('cloud-save-btn');
  const url = urlInput.value.trim();
  
  if (!url) {
    alert('Lütfen önce geçerli bir Google Apps Script Web Uygulaması URL\'si girin.');
    return;
  }

  const gigs = loadState('umut_gigs') || {};
  
  saveBtn.disabled = true;
  saveBtn.textContent = 'Kaydediliyor...';
  statusMsg.textContent = 'Veriler buluta yükleniyor...';
  statusMsg.className = 'cloud-status-text';

  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(gigs)
    });
    
    statusMsg.textContent = 'Buluta gönderildi ve E-Tablo güncellendi!';
    statusMsg.className = 'cloud-status-text success';
  } catch (error) {
    console.error(error);
    statusMsg.textContent = 'Bağlantı hatası. Lütfen URL\'yi kontrol edin.';
    statusMsg.className = 'cloud-status-text error';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Buluta Kaydet';
  }
}

async function loadGigsFromCloud(isInitial = false) {
  const urlInput = document.getElementById('cloud-url-input');
  const statusMsg = document.getElementById('cloud-status-msg');
  const loadBtn = document.getElementById('cloud-load-btn');
  const url = urlInput.value.trim();
  
  if (!url) {
    if (!isInitial) alert('Lütfen önce geçerli bir Google Apps Script Web Uygulaması URL\'si girin.');
    return;
  }

  if (loadBtn) {
    loadBtn.disabled = true;
    loadBtn.textContent = 'Yükleniyor...';
  }
  statusMsg.textContent = 'Veriler buluttan çekiliyor...';
  statusMsg.className = 'cloud-status-text';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Sunucu yanıt vermedi.');
    const data = await res.json();
    
    if (data) {
      saveState('umut_gigs', data);
      
      document.querySelectorAll('.gig-input').forEach(input => {
        const day = input.dataset.day;
        if (day && input.id !== 'cloud-url-input') {
          const type = input.classList.contains('gig-job') ? 'job' : 'outfit';
          if (data[day] && data[day][type] !== undefined) {
            input.value = data[day][type];
          } else {
            input.value = '';
          }
        }
      });

      statusMsg.textContent = 'Buluttan veriler başarıyla yüklendi!';
      statusMsg.className = 'cloud-status-text success';
    }
  } catch (error) {
    console.error(error);
    statusMsg.textContent = 'Buluttan veri çekme hatası. URL veya internet bağlantınızı kontrol edin.';
    statusMsg.className = 'cloud-status-text error';
  } finally {
    if (loadBtn) {
      loadBtn.disabled = false;
      loadBtn.textContent = 'Buluttan Çek';
    }
  }
}

// ════════════════════════════════════════════
//  SERVICE WORKER REGISTRATION (PWA)
// ════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registered.'))
      .catch(err => console.error('Service Worker registration failed:', err));
  });
}

