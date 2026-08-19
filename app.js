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
//  WEB AUDIO METRONOM & TEMPO TRAINER
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

// TEMPO TRAINER DURUMU & AYARLARI
const DEFAULT_TRAINER_CONFIG = {
  enabled: false,
  startBpm: 60,
  targetBpm: 120,
  stepBpm: 2,
  intervalType: 'bars', // 'bars' | 'time'
  barInterval: 4,       // 2, 4, 8, 16
  timeInterval: 30,     // 15, 30, 45, 60
  onTarget: 'stay',     // 'stay' | 'stop' | 'pyramid'
  audioCue: true,
  panelOpen: false
};

let trainerConfig = Object.assign({}, DEFAULT_TRAINER_CONFIG);

let trainerState = {
  currentBars: 0,
  direction: 1, // 1: artış, -1: azalış (piramit modu)
  stepStartTime: 0,
  reachedTarget: false
};

function saveTrainerConfig() {
  saveState('trainer_config', trainerConfig);
}

function loadTrainerConfig() {
  const saved = loadState('trainer_config');
  if (saved) {
    trainerConfig = Object.assign({}, DEFAULT_TRAINER_CONFIG, saved);
  }
}

function setMetroBpm(v, syncInputs = true) {
  let val = parseInt(v, 10);
  if (isNaN(val)) val = 80;
  metroBpm = Math.min(280, Math.max(40, val));
  
  if (syncInputs) {
    const input = document.getElementById('bpm-input');
    if (input) input.value = metroBpm;
  }
  
  // Canlı panelleri ve göstergeleri güncelle
  const liveBpm = document.getElementById('live-current-bpm');
  if (liveBpm) liveBpm.textContent = metroBpm;
  
  const currBpmLbl = document.getElementById('trainer-curr-bpm-lbl');
  if (currBpmLbl) currBpmLbl.textContent = metroBpm;

  updateTrainerProgressBar();
}

function pulseBpmDisplay() {
  const bpmWrap = document.querySelector('.bpm-wrap');
  const liveBadge = document.getElementById('live-current-badge');
  if (bpmWrap) {
    bpmWrap.classList.remove('pulse-tempo');
    void bpmWrap.offsetWidth; // reflow tetikle
    bpmWrap.classList.add('pulse-tempo');
  }
  if (liveBadge) {
    liveBadge.classList.remove('pulse-tempo');
    void liveBadge.offsetWidth;
    liveBadge.classList.add('pulse-tempo');
  }
}

function playTrainerCue(direction = 1) {
  if (!trainerConfig.audioCue) return;
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    // Yükselişte tatlı tiz arpej, düşüşte pesleşen sinyal
    const f1 = direction >= 0 ? 1200 : 1600;
    const f2 = direction >= 0 ? 1800 : 1000;
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f1, t);
    osc.frequency.exponentialRampToValueAtTime(f2, t + 0.08);
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.start(t);
    osc.stop(t + 0.085);
  } catch(e) {}
}

function calculateTrainerProgress() {
  const minB = Math.min(trainerConfig.startBpm, trainerConfig.targetBpm);
  const maxB = Math.max(trainerConfig.startBpm, trainerConfig.targetBpm);
  if (maxB === minB) return 100;
  const pct = Math.min(100, Math.max(0, Math.round(((metroBpm - minB) / (maxB - minB)) * 100)));
  return pct;
}

function updateTrainerProgressBar() {
  const fill = document.getElementById('trainer-progress-fill');
  if (fill) {
    const pct = calculateTrainerProgress();
    fill.style.width = pct + '%';
  }
}

function showTrainerStatusMsg(msg) {
  const note = document.getElementById('trainer-live-note');
  if (note) {
    note.textContent = msg;
    note.style.color = 'var(--text-1)';
    setTimeout(() => {
      if (note) note.style.color = '';
    }, 3500);
  }
}

function triggerTrainerStep(time) {
  const minB = Math.min(trainerConfig.startBpm, trainerConfig.targetBpm);
  const maxB = Math.max(trainerConfig.startBpm, trainerConfig.targetBpm);

  let nextBpm = metroBpm + (trainerState.direction * trainerConfig.stepBpm);

  if (trainerState.direction > 0 && nextBpm >= maxB) {
    nextBpm = maxB;
    if (trainerConfig.onTarget === 'stop') {
      setMetroBpm(nextBpm);
      updateTrainerDashboard();
      playChime();
      stopMetro();
      showTrainerStatusMsg(`🎯 Hedef tempoya (${maxB} BPM) ulaşıldı! Antrenman tamamlandı.`);
      return;
    } else if (trainerConfig.onTarget === 'pyramid') {
      trainerState.direction = -1;
      playTrainerCue(-1);
      showTrainerStatusMsg(`⚡ Zirveye (${maxB} BPM) ulaşıldı! Piramit modu: Tempoyu düşürüyoruz.`);
    } else {
      trainerState.reachedTarget = true;
      playTrainerCue(1);
      showTrainerStatusMsg(`✓ Hedef tempoya (${maxB} BPM) ulaşıldı. Sabit hızda devam ediliyor.`);
    }
  } else if (trainerState.direction < 0 && nextBpm <= minB) {
    nextBpm = minB;
    if (trainerConfig.onTarget === 'pyramid') {
      trainerState.direction = 1;
      playTrainerCue(1);
      showTrainerStatusMsg(`↺ Başlangıç temposuna (${minB} BPM) inildi. Tekrar hızlanıyoruz!`);
    }
  } else {
    playTrainerCue(trainerState.direction);
    const dirIcon = trainerState.direction > 0 ? '▲' : '▼';
    const intervalTxt = trainerConfig.intervalType === 'bars' ? `${trainerConfig.barInterval} ölçü` : `${trainerConfig.timeInterval} sn`;
    showTrainerStatusMsg(`${dirIcon} Tempo ${metroBpm} → ${nextBpm} BPM (${intervalTxt} tamamlandı)`);
  }

  setMetroBpm(nextBpm);
  pulseBpmDisplay();
  updateTrainerDashboard();
}

function handleTrainerBarAdvance(time) {
  if (!trainerConfig.enabled || !metroRunning) return;

  if (trainerConfig.intervalType === 'bars') {
    trainerState.currentBars++;
    if (trainerState.currentBars > trainerConfig.barInterval) {
      trainerState.currentBars = 1;
      triggerTrainerStep(time);
    }
  } else if (trainerConfig.intervalType === 'time') {
    if (!trainerState.stepStartTime) trainerState.stepStartTime = time;
    if (time - trainerState.stepStartTime >= trainerConfig.timeInterval) {
      trainerState.stepStartTime = time;
      triggerTrainerStep(time);
    }
  }
}

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
  while (metroNextTime < ctx.currentTime + 0.12) {
    if (metroBeat === 0 && metroRunning && trainerConfig.enabled) {
      handleTrainerBarAdvance(metroNextTime);
    }
    const spb = 60 / metroBpm;
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

      // Canlı alt sayaç güncellemesi
      if (trainerConfig.enabled && metroRunning) {
        const subInfo = document.getElementById('live-sub-info');
        if (subInfo) {
          if (trainerConfig.intervalType === 'bars') {
            const bar = Math.max(1, trainerState.currentBars || 1);
            subInfo.textContent = `Ölçü: ${bar} / ${trainerConfig.barInterval}`;
          } else {
            const passed = Math.floor(audioCtx.currentTime - (trainerState.stepStartTime || audioCtx.currentTime));
            const rem = Math.max(0, trainerConfig.timeInterval - passed);
            subInfo.textContent = `Kalan: ${rem}s`;
          }
        }
      }
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

  // Antrenman modu açıksa başlangıç durumunu ayarla
  if (trainerConfig.enabled) {
    trainerState.currentBars = 0;
    trainerState.direction = 1;
    trainerState.stepStartTime = audioCtx.currentTime;
    setMetroBpm(trainerConfig.startBpm);
    showTrainerStatusMsg(`Antrenman başladı! ${trainerConfig.startBpm} BPM → ${trainerConfig.targetBpm} BPM`);
  }

  scheduleMetro();
  animateBeats();

  const btn = document.getElementById('metro-toggle');
  btn.textContent = 'Durdur';
  btn.classList.add('running');
  updateTrainerDashboard();
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
  updateTrainerDashboard();
}

document.getElementById('metro-toggle').addEventListener('click', () => {
  metroRunning ? stopMetro() : startMetro();
});

document.getElementById('metro-plus').addEventListener('click', () => {
  setMetroBpm(metroBpm + 1);
  if (metroRunning) { stopMetro(); startMetro(); }
});

document.getElementById('metro-minus').addEventListener('click', () => {
  setMetroBpm(metroBpm - 1);
  if (metroRunning) { stopMetro(); startMetro(); }
});

document.getElementById('bpm-input').addEventListener('change', function () {
  setMetroBpm(this.value);
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
    setMetroBpm(Math.round(60000 / avg));
    if (metroRunning) { stopMetro(); startMetro(); }
  }
  const btn = document.getElementById('tap-btn');
  btn.classList.add('tapped');
  setTimeout(() => btn.classList.remove('tapped'), 140);
  clearTimeout(tapTimes._t);
  tapTimes._t = setTimeout(() => { tapTimes = []; }, 2000);
});

// ════════════════════════════════════════════
//  TEMPO TRAINER KONTROL VE UI YÖNETİMİ
// ════════════════════════════════════════════
function updateTrainerDashboard() {
  const statStart = document.getElementById('stat-start-bpm');
  if (statStart) statStart.textContent = `${trainerConfig.startBpm} BPM`;

  const statTarget = document.getElementById('stat-target-bpm');
  if (statTarget) statTarget.textContent = `${trainerConfig.targetBpm} BPM`;

  const liveBpm = document.getElementById('live-current-bpm');
  if (liveBpm) liveBpm.textContent = metroBpm;

  const subInfo = document.getElementById('live-sub-info');
  if (subInfo) {
    if (trainerConfig.intervalType === 'bars') {
      const b = Math.max(1, trainerState.currentBars || 1);
      subInfo.textContent = `Ölçü: ${b} / ${trainerConfig.barInterval}`;
    } else {
      subInfo.textContent = `Aralık: ${trainerConfig.timeInterval}s`;
    }
  }

  const badge = document.getElementById('trainer-status-pill');
  const toggleBtn = document.getElementById('trainer-toggle-btn');
  if (badge && toggleBtn) {
    if (trainerConfig.enabled) {
      badge.textContent = 'AKTİF';
      badge.classList.add('active');
      toggleBtn.classList.add('active-training');
    } else {
      badge.textContent = 'KAPALI';
      badge.classList.remove('active');
      toggleBtn.classList.remove('active-training');
    }
  }

  updateTrainerProgressBar();
}

function applyTrainerPreset(presetKey) {
  if (presetKey === 'warmup') {
    trainerConfig.startBpm = 60;
    trainerConfig.targetBpm = 100;
    trainerConfig.stepBpm = 2;
    trainerConfig.intervalType = 'bars';
    trainerConfig.barInterval = 4;
    trainerConfig.onTarget = 'stay';
  } else if (presetKey === 'speed') {
    trainerConfig.startBpm = 80;
    trainerConfig.targetBpm = 140;
    trainerConfig.stepBpm = 4;
    trainerConfig.intervalType = 'bars';
    trainerConfig.barInterval = 4;
    trainerConfig.onTarget = 'stay';
  } else if (presetKey === 'endurance') {
    trainerConfig.startBpm = 90;
    trainerConfig.targetBpm = 130;
    trainerConfig.stepBpm = 5;
    trainerConfig.intervalType = 'bars';
    trainerConfig.barInterval = 8;
    trainerConfig.onTarget = 'pyramid';
  } else if (presetKey === 'drill') {
    trainerConfig.startBpm = 100;
    trainerConfig.targetBpm = 160;
    trainerConfig.stepBpm = 2;
    trainerConfig.intervalType = 'bars';
    trainerConfig.barInterval = 2;
    trainerConfig.onTarget = 'stop';
  }

  // Antrenman modunu otomatik aktif et
  trainerConfig.enabled = true;
  saveTrainerConfig();
  syncTrainerUIFromConfig();
  
  // Eğer metronom çalışmıyorsa mevcut tempoyu da başlangıca çek
  if (!metroRunning) {
    setMetroBpm(trainerConfig.startBpm);
  }
  showTrainerStatusMsg(`Preset yüklendi: ${trainerConfig.startBpm} → ${trainerConfig.targetBpm} BPM (+${trainerConfig.stepBpm} BPM / ${trainerConfig.barInterval} Ölçü)`);
}

function syncTrainerUIFromConfig() {
  const enableToggle = document.getElementById('trainer-enable-toggle');
  if (enableToggle) enableToggle.checked = trainerConfig.enabled;

  const startInput = document.getElementById('trainer-start-bpm');
  if (startInput) startInput.value = trainerConfig.startBpm;

  const targetInput = document.getElementById('trainer-target-bpm');
  if (targetInput) targetInput.value = trainerConfig.targetBpm;

  const currBpmLbl = document.getElementById('trainer-curr-bpm-lbl');
  if (currBpmLbl) currBpmLbl.textContent = metroBpm;

  // Step chips
  document.querySelectorAll('#trainer-step-chips .step-chip').forEach(chip => {
    const s = parseInt(chip.dataset.step, 10);
    chip.classList.toggle('active', s === trainerConfig.stepBpm);
  });
  const stepHintVal = document.getElementById('trainer-step-hint-val');
  if (stepHintVal) stepHintVal.textContent = `+${trainerConfig.stepBpm}`;

  // Mode tabs & options
  const modeTabBars = document.getElementById('mode-tab-bars');
  const modeTabTime = document.getElementById('mode-tab-time');
  const barsOptions = document.getElementById('interval-bars-options');
  const timeOptions = document.getElementById('interval-time-options');

  if (trainerConfig.intervalType === 'bars') {
    if (modeTabBars) modeTabBars.classList.add('active');
    if (modeTabTime) modeTabTime.classList.remove('active');
    if (barsOptions) barsOptions.style.display = 'flex';
    if (timeOptions) timeOptions.style.display = 'none';
  } else {
    if (modeTabBars) modeTabBars.classList.remove('active');
    if (modeTabTime) modeTabTime.classList.add('active');
    if (barsOptions) barsOptions.style.display = 'none';
    if (timeOptions) timeOptions.style.display = 'flex';
  }

  // Interval chips
  document.querySelectorAll('#interval-bars-options .interval-chip').forEach(chip => {
    const b = parseInt(chip.dataset.bars, 10);
    chip.classList.toggle('active', b === trainerConfig.barInterval);
  });
  document.querySelectorAll('#interval-time-options .interval-chip').forEach(chip => {
    const t = parseInt(chip.dataset.time, 10);
    chip.classList.toggle('active', t === trainerConfig.timeInterval);
  });

  // Target action radios
  document.querySelectorAll('input[name="trainer-target-action"]').forEach(radio => {
    radio.checked = (radio.value === trainerConfig.onTarget);
  });

  // Audio cue checkbox
  const audioCueChk = document.getElementById('trainer-audio-cue');
  if (audioCueChk) audioCueChk.checked = trainerConfig.audioCue;

  // Panel state
  const panel = document.getElementById('trainer-panel');
  const toggleBtn = document.getElementById('trainer-toggle-btn');
  if (panel && toggleBtn) {
    panel.classList.toggle('open', !!trainerConfig.panelOpen);
    toggleBtn.classList.toggle('panel-open', !!trainerConfig.panelOpen);
  }

  updateTrainerDashboard();
}

function initTempoTrainer() {
  loadTrainerConfig();

  const toggleBtn = document.getElementById('trainer-toggle-btn');
  const panel = document.getElementById('trainer-panel');
  const enableToggle = document.getElementById('trainer-enable-toggle');
  const startInput = document.getElementById('trainer-start-bpm');
  const startPlus = document.getElementById('trainer-start-plus');
  const startMinus = document.getElementById('trainer-start-minus');
  const setCurrentStartBtn = document.getElementById('trainer-set-current-start');
  const targetInput = document.getElementById('trainer-target-bpm');
  const targetPlus = document.getElementById('trainer-target-plus');
  const targetMinus = document.getElementById('trainer-target-minus');
  const modeTabBars = document.getElementById('mode-tab-bars');
  const modeTabTime = document.getElementById('mode-tab-time');
  const audioCueChk = document.getElementById('trainer-audio-cue');
  const resetBtn = document.getElementById('trainer-reset-btn');

  // Paneli Aç / Kapat
  if (toggleBtn && panel) {
    toggleBtn.addEventListener('click', () => {
      trainerConfig.panelOpen = !trainerConfig.panelOpen;
      panel.classList.toggle('open', trainerConfig.panelOpen);
      toggleBtn.classList.toggle('panel-open', trainerConfig.panelOpen);
      saveTrainerConfig();
    });
  }

  // Antrenman Modu Aç / Kapat
  if (enableToggle) {
    enableToggle.addEventListener('change', () => {
      trainerConfig.enabled = enableToggle.checked;
      saveTrainerConfig();
      updateTrainerDashboard();
      if (trainerConfig.enabled && !metroRunning) {
        setMetroBpm(trainerConfig.startBpm);
      }
    });
  }

  // Başlangıç BPM
  if (startInput) {
    startInput.addEventListener('change', () => {
      let v = parseInt(startInput.value, 10);
      if (isNaN(v)) v = 60;
      trainerConfig.startBpm = Math.max(40, Math.min(240, v));
      startInput.value = trainerConfig.startBpm;
      saveTrainerConfig();
      updateTrainerDashboard();
    });
  }
  if (startPlus) {
    startPlus.addEventListener('click', () => {
      trainerConfig.startBpm = Math.min(240, trainerConfig.startBpm + 5);
      if (startInput) startInput.value = trainerConfig.startBpm;
      saveTrainerConfig();
      updateTrainerDashboard();
    });
  }
  if (startMinus) {
    startMinus.addEventListener('click', () => {
      trainerConfig.startBpm = Math.max(40, trainerConfig.startBpm - 5);
      if (startInput) startInput.value = trainerConfig.startBpm;
      saveTrainerConfig();
      updateTrainerDashboard();
    });
  }
  if (setCurrentStartBtn) {
    setCurrentStartBtn.addEventListener('click', () => {
      trainerConfig.startBpm = metroBpm;
      if (startInput) startInput.value = trainerConfig.startBpm;
      saveTrainerConfig();
      updateTrainerDashboard();
      showTrainerStatusMsg(`Başlangıç BPM'i ${metroBpm} olarak ayarlandı.`);
    });
  }

  // Hedef BPM
  if (targetInput) {
    targetInput.addEventListener('change', () => {
      let v = parseInt(targetInput.value, 10);
      if (isNaN(v)) v = 120;
      trainerConfig.targetBpm = Math.max(40, Math.min(280, v));
      targetInput.value = trainerConfig.targetBpm;
      saveTrainerConfig();
      updateTrainerDashboard();
    });
  }
  if (targetPlus) {
    targetPlus.addEventListener('click', () => {
      trainerConfig.targetBpm = Math.min(280, trainerConfig.targetBpm + 5);
      if (targetInput) targetInput.value = trainerConfig.targetBpm;
      saveTrainerConfig();
      updateTrainerDashboard();
    });
  }
  if (targetMinus) {
    targetMinus.addEventListener('click', () => {
      trainerConfig.targetBpm = Math.max(40, trainerConfig.targetBpm - 5);
      if (targetInput) targetInput.value = trainerConfig.targetBpm;
      saveTrainerConfig();
      updateTrainerDashboard();
    });
  }

  // Hedef Quick Chips
  document.querySelectorAll('.target-quick-chips .quick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const val = parseInt(chip.dataset.val, 10);
      if (val) {
        trainerConfig.targetBpm = val;
        if (targetInput) targetInput.value = val;
        saveTrainerConfig();
        updateTrainerDashboard();
      }
    });
  });

  // Step Chips (+1, +2, +3, +4, +5)
  document.querySelectorAll('#trainer-step-chips .step-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#trainer-step-chips .step-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      trainerConfig.stepBpm = parseInt(chip.dataset.step, 10);
      const stepHintVal = document.getElementById('trainer-step-hint-val');
      if (stepHintVal) stepHintVal.textContent = `+${trainerConfig.stepBpm}`;
      saveTrainerConfig();
    });
  });

  // Mode Tabs (Ölçü / Süre)
  if (modeTabBars && modeTabTime) {
    modeTabBars.addEventListener('click', () => {
      trainerConfig.intervalType = 'bars';
      modeTabBars.classList.add('active');
      modeTabTime.classList.remove('active');
      document.getElementById('interval-bars-options').style.display = 'flex';
      document.getElementById('interval-time-options').style.display = 'none';
      saveTrainerConfig();
      updateTrainerDashboard();
    });
    modeTabTime.addEventListener('click', () => {
      trainerConfig.intervalType = 'time';
      modeTabTime.classList.add('active');
      modeTabBars.classList.remove('active');
      document.getElementById('interval-bars-options').style.display = 'none';
      document.getElementById('interval-time-options').style.display = 'flex';
      saveTrainerConfig();
      updateTrainerDashboard();
    });
  }

  // Interval Chips (Ölçü & Süre)
  document.querySelectorAll('#interval-bars-options .interval-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#interval-bars-options .interval-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      trainerConfig.barInterval = parseInt(chip.dataset.bars, 10);
      saveTrainerConfig();
      updateTrainerDashboard();
    });
  });
  document.querySelectorAll('#interval-time-options .interval-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#interval-time-options .interval-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      trainerConfig.timeInterval = parseInt(chip.dataset.time, 10);
      saveTrainerConfig();
      updateTrainerDashboard();
    });
  });

  // Target Action Radios
  document.querySelectorAll('input[name="trainer-target-action"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        trainerConfig.onTarget = radio.value;
        saveTrainerConfig();
      }
    });
  });

  // Audio Cue Checkbox
  if (audioCueChk) {
    audioCueChk.addEventListener('change', () => {
      trainerConfig.audioCue = audioCueChk.checked;
      saveTrainerConfig();
    });
  }

  // Preset Buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTrainerPreset(btn.dataset.preset);
    });
  });

  // Reset Antrenman
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      trainerState.currentBars = 0;
      trainerState.direction = 1;
      if (audioCtx) trainerState.stepStartTime = audioCtx.currentTime;
      setMetroBpm(trainerConfig.startBpm);
      updateTrainerDashboard();
      showTrainerStatusMsg(`Antrenman başa sarıldı (${trainerConfig.startBpm} BPM).`);
      pulseBpmDisplay();
    });
  }

  syncTrainerUIFromConfig();
}

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

  // 6) Tempo Trainer Başlatıcı
  initTempoTrainer();
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

