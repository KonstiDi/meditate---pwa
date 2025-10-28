
// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js');
  });
}

// DOM helpers
const $ = sel => document.querySelector(sel);

// State
let sessions = [];
let current = null;
let audio = new Audio();
audio.preload = 'auto';
let wakeLock = null;

// Error handling
function showError(message) {
  const toast = $('#errorToast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 5000);
}

// Check if session is cached
async function isSessionCached(fileUrl) {
  try {
    const cache = await caches.open('calmstart-audio-v1');
    const response = await cache.match(fileUrl);
    return !!response;
  } catch (e) {
    console.error('Cache check error:', e);
    return false;
  }
}

// Load sessions with offline indicators
async function loadSessions() {
  try {
    const res = await fetch('sessions.json');
    if (!res.ok) throw new Error('Failed to load sessions');
    sessions = await res.json();
    await renderSessions();
  } catch (e) {
    showError('Failed to load sessions. Please check your connection.');
    console.error('Load sessions error:', e);
  }
}

async function renderSessions(filterCategory = 'all') {
  const list = $('#sessionList');
  list.innerHTML = '';

  const filtered = filterCategory === 'all'
    ? sessions
    : sessions.filter(s => s.category === filterCategory);

  for (const s of filtered) {
    const li = document.createElement('li');
    const isCached = await isSessionCached(s.file);

    li.innerHTML = `
      <span>
        ${s.title} · ${s.length_min} min
        ${isCached ? '<span class="session-badge badge-offline">Offline</span>' : ''}
        <span class="session-badge badge-category">${s.category || 'general'}</span>
      </span>
      <span><button data-play="${s.id}" aria-label="Play ${s.title}">Play</button></span>
    `;
    list.appendChild(li);
  }
}

// Category filter
$('#categoryFilter').addEventListener('change', (e) => {
  renderSessions(e.target.value);
});

// Play handling
function setNowPlaying(s) {
  $('#nowPlaying').textContent = s ? s.title : '—';
  $('#currentTime').textContent = '0:00';
  $('#totalTime').textContent = '0:00';
  $('#progressFill').style.width = '0%';
  $('#offlineToggle').checked = false;
  current = s;

  if (s) {
    checkOfflineStatus();
  }
}

async function checkOfflineStatus() {
  if (!current) return;
  const isCached = await isSessionCached(current.file);
  $('#offlineToggle').checked = isCached;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function updateProgress() {
  if (audio && !audio.paused && audio.duration) {
    const currentTime = audio.currentTime;
    const duration = audio.duration;
    const percent = (currentTime / duration) * 100;

    $('#progressFill').style.width = `${percent}%`;
    $('#currentTime').textContent = formatTime(currentTime);
    $('#totalTime').textContent = formatTime(duration);

    requestAnimationFrame(updateProgress);
  }
}

// Progress bar click/keyboard navigation
const progressContainer = $('.progress-container');
progressContainer.addEventListener('click', (e) => {
  if (!audio.duration) return;
  const rect = e.currentTarget.querySelector('.progress-bar').getBoundingClientRect();
  const percent = (e.clientX - rect.left) / rect.width;
  audio.currentTime = percent * audio.duration;
});

progressContainer.addEventListener('keydown', (e) => {
  if (!audio.duration) return;
  if (e.key === 'ArrowLeft') {
    audio.currentTime = Math.max(0, audio.currentTime - 5);
  } else if (e.key === 'ArrowRight') {
    audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
  }
});

async function playSessionById(id) {
  try {
    const s = sessions.find(x => x.id === id);
    if (!s) {
      showError('Session not found');
      return;
    }

    setNowPlaying(s);
    audio.src = s.file;

    // Request wake lock
    await requestWakeLock();

    await audio.play();
    $('#playPause').textContent = 'Pause';
    requestAnimationFrame(updateProgress);
  } catch (e) {
    showError('Failed to play audio. Please try again.');
    console.error('Play error:', e);
  }
}

$('#sessionList').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-play]');
  if (!btn) return;
  playSessionById(btn.dataset.play);
});

$('#quickPlay').addEventListener('click', () => playSessionById('quick-3'));

$('#playPause').addEventListener('click', async () => {
  if (!current) return;

  try {
    if (audio.paused) {
      await audio.play();
      $('#playPause').textContent = 'Pause';
      await requestWakeLock();
      requestAnimationFrame(updateProgress);
    } else {
      audio.pause();
      $('#playPause').textContent = 'Play';
      releaseWakeLock();
    }
  } catch (e) {
    showError('Playback error. Please try again.');
    console.error('Playback error:', e);
  }
});

// Skip controls
$('#skipBack').addEventListener('click', () => {
  if (!audio.duration) return;
  audio.currentTime = Math.max(0, audio.currentTime - 10);
});

$('#skipForward').addEventListener('click', () => {
  if (!audio.duration) return;
  audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
});

// Volume control
const volumeSlider = $('#volumeSlider');
const volumeDisplay = $('#volumeDisplay');

volumeSlider.addEventListener('input', (e) => {
  const volume = e.target.value / 100;
  audio.volume = volume;
  volumeDisplay.textContent = `${e.target.value}%`;
  localStorage.setItem('volume', e.target.value);
});

// Restore volume
const savedVolume = localStorage.getItem('volume') || 100;
volumeSlider.value = savedVolume;
audio.volume = savedVolume / 100;
volumeDisplay.textContent = `${savedVolume}%`;

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Escape key to close modals (always works)
  if (e.key === 'Escape') {
    $('#completionModal').classList.add('hidden');
    $('#historyModal').classList.add('hidden');
    return;
  }

  // Only handle other shortcuts if not typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    return;
  }

  if (e.code === 'Space') {
    e.preventDefault();
    $('#playPause').click();
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    $('#skipBack').click();
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    $('#skipForward').click();
  }
});

// Streak + minutes + sessions + history
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
  $('#streak').textContent = s.streak;
  $('#minutes').textContent = s.minutes;
  $('#totalSessions').textContent = s.totalSessions;

  if (s.lastDay) {
    const lastDate = new Date(s.lastDay);
    const daysSince = Math.floor((new Date() - lastDate) / (1000 * 60 * 60 * 24));
    if (daysSince === 0) {
      $('#lastMeditated').textContent = 'Last meditated: Today';
    } else if (daysSince === 1) {
      $('#lastMeditated').textContent = 'Last meditated: Yesterday';
    } else {
      $('#lastMeditated').textContent = `Last meditated: ${daysSince} days ago`;
    }
  } else {
    $('#lastMeditated').textContent = '';
  }
}

function showCompletionModal(sessionTitle, updatedStats) {
  const modal = $('#completionModal');
  const messages = [
    'Wonderful work!',
    'Great job!',
    'Well done!',
    'Excellent session!',
    'You did it!'
  ];
  const randomMessage = messages[Math.floor(Math.random() * messages.length)];

  $('#completionMessage').textContent = `${randomMessage} You've completed "${sessionTitle}".`;
  $('#completionStats').innerHTML = `
    <p><strong>Current Streak:</strong> ${updatedStats.streak} days</p>
    <p><strong>Total Sessions:</strong> ${updatedStats.totalSessions}</p>
    <p><strong>Total Minutes:</strong> ${updatedStats.minutes}</p>
  `;

  modal.classList.remove('hidden');
  $('#closeCompletion').focus();
}

$('#closeCompletion').addEventListener('click', () => {
  $('#completionModal').classList.add('hidden');
});

// Close modal on backdrop click
$('#completionModal').addEventListener('click', (e) => {
  if (e.target === $('#completionModal')) {
    $('#completionModal').classList.add('hidden');
  }
});

$('#historyModal').addEventListener('click', (e) => {
  if (e.target === $('#historyModal')) {
    $('#historyModal').classList.add('hidden');
  }
});

// Audio ended event - update stats and show completion
audio.addEventListener('ended', () => {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const st = getStats();

  // Update streak
  if (st.lastDay !== day) {
    const prev = st.lastDay ? new Date(st.lastDay) : null;
    let newStreak = st.streak || 0;
    if (prev) {
      const diff = (now - new Date(st.lastDay)) / (1000 * 60 * 60 * 24);
      newStreak = (diff <= 2) ? newStreak + 1 : 1;
    } else {
      newStreak = 1;
    }
    st.streak = newStreak;
    st.lastDay = day;
  }

  // Update minutes and sessions
  st.minutes = Math.round((st.minutes || 0) + (current?.length_min || 0));
  st.totalSessions = (st.totalSessions || 0) + 1;

  // Add to history
  if (!st.history) st.history = [];
  st.history.unshift({
    date: now.toISOString(),
    session: current?.title || 'Unknown',
    duration: current?.length_min || 0
  });
  // Keep last 30 entries
  st.history = st.history.slice(0, 30);

  setStats(st);
  showCompletionModal(current?.title || 'Session', st);

  releaseWakeLock();
  $('#playPause').textContent = 'Play';
});

// Audio error handling
audio.addEventListener('error', (e) => {
  showError('Audio playback error. The file may not be available.');
  console.error('Audio error:', e);
  releaseWakeLock();
});

// Offline toggle: cache/un-cache current session file
$('#offlineToggle').addEventListener('change', async (e) => {
  if (!current) {
    e.target.checked = false;
    return;
  }

  try {
    const cache = await caches.open('calmstart-audio-v1');
    if (e.target.checked) {
      await cache.add(current.file);
      await renderSessions($('#categoryFilter').value);
    } else {
      await cache.delete(current.file);
      await renderSessions($('#categoryFilter').value);
    }
  } catch (e) {
    showError('Failed to update offline status.');
    console.error('Cache error:', e);
  }
});

// View history
$('#viewHistory').addEventListener('click', () => {
  const st = getStats();
  const historyContent = $('#historyContent');

  if (!st.history || st.history.length === 0) {
    historyContent.innerHTML = '<p class="muted-text">No meditation history yet. Complete a session to see it here!</p>';
  } else {
    let html = '';
    st.history.forEach(entry => {
      const date = new Date(entry.date);
      const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      html += `
        <div class="history-item">
          <strong>${entry.session}</strong> · ${entry.duration} min<br>
          <span class="muted-text">${dateStr} at ${timeStr}</span>
        </div>
      `;
    });
    historyContent.innerHTML = html;
  }

  $('#historyModal').classList.remove('hidden');
  $('#closeHistory').focus();
});

$('#closeHistory').addEventListener('click', () => {
  $('#historyModal').classList.add('hidden');
});

// Wake Lock API implementation
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        console.log('Wake lock released');
      });
    } catch (e) {
      console.error('Wake lock error:', e);
      // Not critical, so don't show error to user
    }
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

// Re-acquire wake lock when page becomes visible
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && !audio.paused && current) {
    await requestWakeLock();
  }
});

// Simple onboarding (time-only)
const ONBOARDED = 'onboarded';
function showOnboardingIfNeeded() {
  const done = localStorage.getItem(ONBOARDED);
  $('#onboarding').classList.toggle('hidden', !!done);
}

$('#saveOnboarding').addEventListener('click', () => {
  const time = $('#reminderTime').value;
  localStorage.setItem('reminderTime', time || '');
  localStorage.setItem(ONBOARDED, '1');
  $('#onboarding').classList.add('hidden');
  alert('Saved. Tip: add a daily phone reminder at your chosen time.');
});

// Install prompt
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('#installBtn').hidden = false;
});

$('#installBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  try {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    $('#installBtn').hidden = true;
  } catch (e) {
    console.error('Install prompt error:', e);
  }
});

// Init
(async function init() {
  try {
    console.log('=== INIT START ===');

    // Ensure modals are hidden on page load
    $('#completionModal').classList.add('hidden');
    $('#historyModal').classList.add('hidden');
    $('#errorToast').classList.add('hidden');

    console.log('Modals hidden:', {
      completion: $('#completionModal').classList.contains('hidden'),
      history: $('#historyModal').classList.contains('hidden')
    });

    await loadSessions();
    const st = getStats();
    setStats(st);
    showOnboardingIfNeeded();

    console.log('=== INIT COMPLETE ===');
  } catch (e) {
    showError('Initialization error. Please refresh the page.');
    console.error('Init error:', e);
  }
})();
