// ============================================
// EQUIPOISE - Meditation PWA
// Single Page Application
// ============================================

// --- Service Worker ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js');
  });
}

// --- DOM Helpers ---
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// --- State ---
let sessions = [];
let current = null;
let audio = new Audio();
audio.preload = 'auto';
let wakeLock = null;
let timerInterval = null;
let timerRemaining = 0;
let timerDuration = 5 * 60; // default 5 min
let timerRunning = false;

// Category gradients for session cards (Swiss nature inspired)
const categoryGradients = {
  guided: 'var(--gradient-lake)',
  breathing: 'var(--gradient-forest)',
  music: 'var(--gradient-sunset)',
  bell: 'var(--gradient-mountain)',
  default: 'var(--gradient-calm)'
};

// ============================================
// SPA NAVIGATION
// ============================================
function navigateTo(viewId) {
  const isWelcome = viewId === 'welcome';
  const isPlayer = viewId === 'player';

  // Show/hide header and nav
  $('#appHeader').classList.toggle('hidden', isWelcome || isPlayer);
  $('#bottomNav').classList.toggle('hidden', isWelcome || isPlayer);

  // Deactivate all views
  $$('.view').forEach(v => v.classList.remove('active'));

  // Activate target view
  const target = $(`#view-${viewId}`);
  if (target) {
    target.classList.add('active');
  }

  // Update nav items
  $$('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewId);
  });

  // Update greeting when going to home
  if (viewId === 'home') {
    updateGreeting();
    updateHomeStats();
  }

  // Update profile stats
  if (viewId === 'profile') {
    updateProfileStats();
  }

  // Pause background video when not on welcome
  const video = $('.welcome-bg');
  if (video) {
    if (isWelcome) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }
}

// Bottom Nav click handlers
$('#bottomNav').addEventListener('click', (e) => {
  const navItem = e.target.closest('.nav-item');
  if (!navItem) return;
  navigateTo(navItem.dataset.view);
});

// Enter app from welcome
$('#enterAppBtn').addEventListener('click', () => {
  const onboarded = localStorage.getItem('onboarded');
  if (!onboarded) {
    $('#onboarding').classList.remove('hidden');
  } else {
    navigateTo('home');
  }
});

// ============================================
// GREETING
// ============================================
function updateGreeting() {
  const hour = new Date().getHours();
  let greeting = 'Good evening';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 17) greeting = 'Good afternoon';

  $('#greetingText').textContent = greeting;
}

// ============================================
// ERROR HANDLING
// ============================================
function showError(message) {
  const toast = $('#errorToast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
}

// ============================================
// SESSION MANAGEMENT
// ============================================
async function isSessionCached(fileUrl) {
  try {
    const cache = await caches.open('equipoise-audio-v1');
    const response = await cache.match(fileUrl);
    return !!response;
  } catch (e) {
    return false;
  }
}

async function loadSessions() {
  try {
    const res = await fetch('sessions.json');
    if (!res.ok) throw new Error('Failed to load sessions');
    sessions = await res.json();
    await renderSessions();
    updateFeaturedSession();
  } catch (e) {
    showError('Failed to load sessions.');
    console.error('Load sessions error:', e);
  }
}

function updateFeaturedSession() {
  if (sessions.length === 0) return;
  // Pick "session of the day" based on date
  const dayIndex = new Date().getDate() % sessions.length;
  const featured = sessions[dayIndex];
  $('#featuredTitle').textContent = featured.title;
  $('#featuredMeta').textContent = `${featured.category} · ${featured.length_min} min`;
  $('#featuredCard').dataset.sessionId = featured.id;

  // Set gradient based on category
  const gradient = categoryGradients[featured.category] || categoryGradients.default;
  $('#featuredCard').querySelector('.featured-card-bg').style.background = gradient;
}

async function renderSessions(filterCategory = 'all') {
  const grid = $('#sessionGrid');
  grid.innerHTML = '';

  const filtered = filterCategory === 'all'
    ? sessions
    : sessions.filter(s => s.category === filterCategory);

  for (const s of filtered) {
    const isCached = await isSessionCached(s.file);
    const gradient = categoryGradients[s.category] || categoryGradients.default;

    const card = document.createElement('div');
    card.className = 'session-card';
    card.dataset.sessionId = s.id;
    card.innerHTML = `
      <div class="session-thumb" style="background: ${gradient};">
        <span class="session-thumb-icon">🎵</span>
      </div>
      <div class="session-info">
        <h3 class="session-title">${s.title}</h3>
        <div class="session-meta">
          <span>${s.length_min} min</span>
          <span class="session-badge badge-category">${s.category}</span>
          ${isCached ? '<span class="session-badge badge-offline">Offline</span>' : ''}
        </div>
      </div>
      <button class="session-play-btn" data-play="${s.id}" aria-label="Play ${s.title}">
        <svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>
      </button>
    `;
    grid.appendChild(card);
  }
}

// Category filter
$('#categoryPills').addEventListener('click', (e) => {
  const pill = e.target.closest('.category-pill');
  if (!pill) return;

  $$('.category-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  renderSessions(pill.dataset.category);
});

// Session card click - play
$('#sessionGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('.session-play-btn');
  const card = e.target.closest('.session-card');
  if (btn) {
    playSessionById(btn.dataset.play);
  } else if (card) {
    playSessionById(card.dataset.sessionId);
  }
});

// Featured card click
$('#featuredCard').addEventListener('click', () => {
  const id = $('#featuredCard').dataset.sessionId;
  if (id) playSessionById(id);
});

// ============================================
// AUDIO PLAYER
// ============================================
function formatTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function updateProgressRing() {
  if (audio && !audio.paused && audio.duration) {
    const progress = audio.currentTime / audio.duration;
    const circumference = 2 * Math.PI * 112; // r=112
    const offset = circumference * (1 - progress);

    $('#progressRingFill').style.strokeDasharray = circumference;
    $('#progressRingFill').style.strokeDashoffset = offset;
    $('#playerTimeCurrent').textContent = formatTime(audio.currentTime);
    $('#playerTimeTotal').textContent = formatTime(audio.duration);

    requestAnimationFrame(updateProgressRing);
  }
}

// Click on progress ring to seek
$('#progressRingContainer').addEventListener('click', (e) => {
  if (!audio.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) + Math.PI / 2;
  let progress = angle / (2 * Math.PI);
  if (progress < 0) progress += 1;
  audio.currentTime = progress * audio.duration;
});

async function playSessionById(id) {
  try {
    const s = sessions.find(x => x.id === id);
    if (!s) { showError('Session not found'); return; }

    current = s;

    // Set player UI
    $('#playerTitle').textContent = s.title;
    $('#playerCategory').textContent = s.category;
    $('#playerTimeCurrent').textContent = '0:00';
    $('#playerTimeTotal').textContent = '0:00';
    $('#progressRingFill').style.strokeDashoffset = 2 * Math.PI * 112;

    // Set background gradient
    const gradient = categoryGradients[s.category] || categoryGradients.default;
    $('#playerBgGradient').style.background = gradient;

    // Check offline status
    const isCached = await isSessionCached(s.file);
    $('#offlineToggle').checked = isCached;

    // Navigate to player
    navigateTo('player');

    // Play audio
    audio.src = s.file;
    await requestWakeLock();
    await audio.play();
    showPlayingState(true);
    requestAnimationFrame(updateProgressRing);
  } catch (e) {
    showError('Failed to play. Please try again.');
    console.error('Play error:', e);
  }
}

function showPlayingState(playing) {
  $('#playIcon').classList.toggle('hidden', playing);
  $('#pauseIcon').classList.toggle('hidden', !playing);
}

// Play/Pause
$('#playerPlayPause').addEventListener('click', async () => {
  if (!current) return;
  try {
    if (audio.paused) {
      await audio.play();
      showPlayingState(true);
      await requestWakeLock();
      requestAnimationFrame(updateProgressRing);
    } else {
      audio.pause();
      showPlayingState(false);
      releaseWakeLock();
    }
  } catch (e) {
    showError('Playback error.');
  }
});

// Skip controls
$('#playerSkipBack').addEventListener('click', () => {
  if (!audio.duration) return;
  audio.currentTime = Math.max(0, audio.currentTime - 10);
});

$('#playerSkipForward').addEventListener('click', () => {
  if (!audio.duration) return;
  audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
});

// Volume
const playerVolume = $('#playerVolume');
const savedVolume = localStorage.getItem('volume') || 100;
playerVolume.value = savedVolume;
audio.volume = savedVolume / 100;

playerVolume.addEventListener('input', (e) => {
  audio.volume = e.target.value / 100;
  localStorage.setItem('volume', e.target.value);
});

// Offline toggle
$('#offlineToggle').addEventListener('change', async (e) => {
  if (!current) { e.target.checked = false; return; }
  try {
    const cache = await caches.open('equipoise-audio-v1');
    if (e.target.checked) {
      await cache.add(current.file);
    } else {
      await cache.delete(current.file);
    }
    await renderSessions($('.category-pill.active')?.dataset.category || 'all');
  } catch (err) {
    showError('Failed to update offline status.');
  }
});

// Close player
$('#playerClose').addEventListener('click', () => {
  audio.pause();
  showPlayingState(false);
  releaseWakeLock();
  navigateTo('home');
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('#completionModal').classList.add('hidden');
    $('#historyModal').classList.add('hidden');
    if ($('#view-player').classList.contains('active')) {
      $('#playerClose').click();
    }
    return;
  }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  if (e.code === 'Space') {
    e.preventDefault();
    $('#playerPlayPause').click();
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    $('#playerSkipBack').click();
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    $('#playerSkipForward').click();
  }
});

// ============================================
// STATS
// ============================================
function getStats() {
  const stats = JSON.parse(localStorage.getItem('stats') || '{}');
  return {
    streak: stats.streak || 0,
    minutes: stats.minutes || 0,
    totalSessions: stats.totalSessions || 0,
    lastDay: stats.lastDay || null,
    history: stats.history || []
  };
}

function setStats(s) {
  localStorage.setItem('stats', JSON.stringify(s));
  updateHomeStats();
  updateProfileStats();
}

function updateHomeStats() {
  const st = getStats();
  $('#homeStreak').textContent = st.streak;
  $('#homeSessions').textContent = st.totalSessions;
  $('#homeMinutes').textContent = st.minutes;
}

function updateProfileStats() {
  const st = getStats();
  $('#profileStreak').textContent = st.streak;
  $('#profileSessions').textContent = st.totalSessions;
  $('#profileMinutes').textContent = st.minutes;

  if (st.lastDay) {
    const lastDate = new Date(st.lastDay);
    const daysSince = Math.floor((new Date() - lastDate) / (1000 * 60 * 60 * 24));
    if (daysSince === 0) $('#lastMeditated').textContent = 'Last meditated: Today';
    else if (daysSince === 1) $('#lastMeditated').textContent = 'Last meditated: Yesterday';
    else $('#lastMeditated').textContent = `Last meditated: ${daysSince} days ago`;
  } else {
    $('#lastMeditated').textContent = 'Start your journey today';
  }
}

function recordSession(title, durationMin) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const st = getStats();

  // Update streak
  if (st.lastDay !== day) {
    const prev = st.lastDay ? new Date(st.lastDay) : null;
    if (prev) {
      const diff = (now - prev) / (1000 * 60 * 60 * 24);
      st.streak = (diff <= 2) ? st.streak + 1 : 1;
    } else {
      st.streak = 1;
    }
    st.lastDay = day;
  }

  st.minutes = Math.round((st.minutes || 0) + durationMin);
  st.totalSessions = (st.totalSessions || 0) + 1;

  // History
  st.history.unshift({
    date: now.toISOString(),
    session: title,
    duration: durationMin
  });
  st.history = st.history.slice(0, 30);

  setStats(st);
  return st;
}

// Completion modal
function showCompletionModal(title, stats) {
  const messages = ['Wonderful work', 'Beautifully done', 'Inner peace achieved', 'Well balanced', 'Namaste'];
  const msg = messages[Math.floor(Math.random() * messages.length)];

  $('#completionMessage').textContent = `${msg}. You completed "${title}".`;
  $('#completionStats').innerHTML = `
    <p style="margin:4px 0;"><strong>${stats.streak}</strong> day streak</p>
    <p style="margin:4px 0;"><strong>${stats.totalSessions}</strong> total sessions</p>
    <p style="margin:4px 0;"><strong>${stats.minutes}</strong> total minutes</p>
  `;

  $('#completionModal').classList.remove('hidden');
  $('#closeCompletion').focus();
}

$('#closeCompletion').addEventListener('click', () => {
  $('#completionModal').classList.add('hidden');
  navigateTo('home');
});

$('#completionModal').addEventListener('click', (e) => {
  if (e.target === $('#completionModal')) {
    $('#completionModal').classList.add('hidden');
    navigateTo('home');
  }
});

// Audio ended
audio.addEventListener('ended', () => {
  const title = current?.title || 'Session';
  const duration = current?.length_min || 0;
  const stats = recordSession(title, duration);
  showCompletionModal(title, stats);
  releaseWakeLock();
  showPlayingState(false);
});

audio.addEventListener('error', () => {
  showError('Audio error. The file may not be available.');
  releaseWakeLock();
});

// ============================================
// TIMER
// ============================================
$('#timerPresets').addEventListener('click', (e) => {
  const preset = e.target.closest('.timer-preset');
  if (!preset || timerRunning) return;

  $$('.timer-preset').forEach(p => p.classList.remove('active'));
  preset.classList.add('active');

  timerDuration = parseInt(preset.dataset.minutes) * 60;
  timerRemaining = timerDuration;
  $('#timerDisplay').textContent = formatTime(timerDuration);
});

$('#timerStartBtn').addEventListener('click', () => {
  if (timerRunning) {
    stopTimer();
  } else {
    startTimer();
  }
});

function startTimer() {
  timerRunning = true;
  timerRemaining = timerDuration;
  $('#timerStartBtn').textContent = 'Stop';
  $('#breathingCircle').classList.add('active');
  updateBreathingLabel();

  requestWakeLock();

  timerInterval = setInterval(() => {
    timerRemaining--;
    $('#timerDisplay').textContent = formatTime(timerRemaining);
    updateBreathingLabel();

    if (timerRemaining <= 0) {
      stopTimer();
      // Play bell sound
      const bell = new Audio('audio/bell.wav');
      bell.volume = audio.volume;
      bell.play().catch(() => {});
      // Record as session
      const mins = timerDuration / 60;
      const stats = recordSession(`${mins}-min Timer`, mins);
      showCompletionModal(`${mins}-minute Timer`, stats);
    }
  }, 1000);
}

function stopTimer() {
  timerRunning = false;
  clearInterval(timerInterval);
  $('#timerStartBtn').textContent = 'Start';
  $('#breathingCircle').classList.remove('active');
  $('#breathingLabel').textContent = 'Breathe';
  $('#timerDisplay').textContent = formatTime(timerDuration);
  releaseWakeLock();
}

function updateBreathingLabel() {
  if (!timerRunning) return;
  // 8-second cycle: 4s inhale, 4s exhale
  const cyclePos = timerRemaining % 8;
  if (cyclePos >= 4) {
    $('#breathingLabel').textContent = 'Breathe in';
  } else {
    $('#breathingLabel').textContent = 'Breathe out';
  }
}

// ============================================
// HISTORY
// ============================================
$('#viewHistory').addEventListener('click', () => {
  const st = getStats();
  const content = $('#historyContent');

  if (!st.history.length) {
    content.innerHTML = '<p class="muted-text" style="text-align:center;">No history yet. Complete a session to see it here.</p>';
  } else {
    content.innerHTML = st.history.map(entry => {
      const date = new Date(entry.date);
      const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="history-item">
          <strong>${entry.session}</strong> · ${entry.duration} min<br>
          <span class="muted-text">${dateStr} at ${timeStr}</span>
        </div>
      `;
    }).join('');
  }

  $('#historyModal').classList.remove('hidden');
  $('#closeHistory').focus();
});

$('#closeHistory').addEventListener('click', () => {
  $('#historyModal').classList.add('hidden');
});

$('#historyModal').addEventListener('click', (e) => {
  if (e.target === $('#historyModal')) {
    $('#historyModal').classList.add('hidden');
  }
});

// ============================================
// QUICK ACTIONS (Home View)
// ============================================
$$('.quick-action').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    if (action === 'quick-play') playSessionById('quick-3');
    else if (action === 'timer') navigateTo('timer');
    else if (action === 'breathe') {
      navigateTo('timer');
      // Auto-start the breathing
      setTimeout(() => {
        if (!timerRunning) {
          // Set to 3 min for quick breathe
          $$('.timer-preset').forEach(p => p.classList.remove('active'));
          const threeMin = [...$$('.timer-preset')].find(p => p.dataset.minutes === '3');
          if (threeMin) threeMin.classList.add('active');
          timerDuration = 3 * 60;
          timerRemaining = timerDuration;
          startTimer();
        }
      }, 300);
    }
    else if (action === 'browse') navigateTo('meditate');
  });
});

// ============================================
// WAKE LOCK
// ============================================
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {
      // Not critical
    }
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && !audio.paused && current) {
    await requestWakeLock();
  }
  // Pause welcome video when hidden
  const video = $('.welcome-bg');
  if (video && $('#view-welcome').classList.contains('active')) {
    if (document.visibilityState === 'hidden') video.pause();
    else video.play().catch(() => {});
  }
});

// ============================================
// ONBOARDING
// ============================================
$('#saveOnboarding').addEventListener('click', () => {
  const time = $('#reminderTime').value;
  localStorage.setItem('reminderTime', time || '');
  localStorage.setItem('onboarded', '1');
  $('#onboarding').classList.add('hidden');
  navigateTo('home');
});

$('#skipOnboarding').addEventListener('click', () => {
  localStorage.setItem('onboarded', '1');
  $('#onboarding').classList.add('hidden');
  navigateTo('home');
});

// ============================================
// INSTALL PROMPT
// ============================================
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const welcomeBtn = $('#installBtnWelcome');
  const headerBtn = $('#installBtnHeader');
  if (welcomeBtn) welcomeBtn.hidden = false;
  if (headerBtn) headerBtn.hidden = false;
});

function handleInstall() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(() => {
    if ($('#installBtnWelcome')) $('#installBtnWelcome').hidden = true;
    if ($('#installBtnHeader')) $('#installBtnHeader').hidden = true;
  });
}

$('#installBtnWelcome')?.addEventListener('click', handleInstall);
$('#installBtnHeader')?.addEventListener('click', handleInstall);

// ============================================
// INIT
// ============================================
(async function init() {
  try {
    // Ensure modals are hidden
    $('#completionModal').classList.add('hidden');
    $('#historyModal').classList.add('hidden');
    $('#errorToast').classList.add('hidden');

    await loadSessions();
    updateHomeStats();
    updateGreeting();
  } catch (e) {
    showError('Initialization error. Please refresh.');
    console.error('Init error:', e);
  }
})();
