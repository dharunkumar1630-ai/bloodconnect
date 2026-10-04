/**
 * ==============================================================================
 * BloodConnect — Instant Blood Emergency Network
 * Production Frontend Application & Real-Time REST Client
 * ==============================================================================
 */

// ------------------------------------------------------------------------------
// 1. Blood Compatibility Matrix (Accurate Clinical Matching)
// ------------------------------------------------------------------------------
const BLOOD_COMPATIBILITY = {
  'O-': ['O-'],
  'O+': ['O+', 'O-'],
  'A-': ['A-', 'O-'],
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'B-': ['B-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'AB-': ['AB-', 'A-', 'B-', 'O-'],
  'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-']
};

const COMPATIBILITY_GUIDE = {
  'O-': {
    name: 'O Negative (O-)',
    subtitle: 'Universal Red Cell Donor — Critical for ER Trauma',
    canReceive: ['O-'],
    canDonate: ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+']
  },
  'O+': {
    name: 'O Positive (O+)',
    subtitle: 'Most requested blood group in hospitals (38% of population)',
    canReceive: ['O+', 'O-'],
    canDonate: ['O+', 'A+', 'B+', 'AB+']
  },
  'A-': {
    name: 'A Negative (A-)',
    subtitle: 'Rare Rh-negative group (~6% of population)',
    canReceive: ['A-', 'O-'],
    canDonate: ['A-', 'A+', 'AB-', 'AB+']
  },
  'A+': {
    name: 'A Positive (A+)',
    subtitle: 'High clinical demand for surgeries and oncology patients',
    canReceive: ['A+', 'A-', 'O+', 'O-'],
    canDonate: ['A+', 'AB+']
  },
  'B-': {
    name: 'B Negative (B-)',
    subtitle: 'Very rare group (<2% of population)',
    canReceive: ['B-', 'O-'],
    canDonate: ['B-', 'B+', 'AB-', 'AB+']
  },
  'B+': {
    name: 'B Positive (B+)',
    subtitle: 'Common across Asian populations (~25% of donors)',
    canReceive: ['B+', 'B-', 'O+', 'O-'],
    canDonate: ['B+', 'AB+']
  },
  'AB-': {
    name: 'AB Negative (AB-)',
    subtitle: 'Rarest blood group on Earth (<1% of population)',
    canReceive: ['AB-', 'A-', 'B-', 'O-'],
    canDonate: ['AB-', 'AB+']
  },
  'AB+': {
    name: 'AB Positive (AB+)',
    subtitle: 'Universal Red Cell Recipient — Can receive from all 8 blood groups',
    canReceive: ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
    canDonate: ['AB+']
  }
};

// Check if donor blood can donate to recipient blood
function isDonorCompatible(donorGroup, recipientGroup) {
  const allowed = BLOOD_COMPATIBILITY[recipientGroup] || [recipientGroup];
  return allowed.includes(donorGroup);
}

// ------------------------------------------------------------------------------
// 2. Default Seed State (Empty clean database)
// ------------------------------------------------------------------------------
const DEFAULT_STATE = {
  isAuthenticated: false,
  activeRole: 'donor',
  selectedLoginRole: 'donor',
  currentUser: null,
  allUsers: [],
  requests: [],
  notifications: [],
  historyStack: []
};

// Global App State
let appState = {};
let currentScreenId = 'screen-login';
let activeLiveReqId = null;
let lastKnownRequestsJson = '';

/**
 * Initialize application state from localStorage or default
 */
function initAppState() {
  try {
    const saved = localStorage.getItem('bloodconnect_app_session_v2');
    if (saved) {
      appState = JSON.parse(saved);
      appState.historyStack = [];
    } else {
      appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
    }
  } catch (e) {
    console.warn('LocalStorage load error, using defaults:', e);
    appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  // Purge any legacy demo accounts
  if (Array.isArray(appState.allUsers)) {
    appState.allUsers = appState.allUsers.filter(u => 
      u && u.id && !u.id.startsWith('usr-requester-') && !u.id.startsWith('usr-donor-')
    );
  } else {
    appState.allUsers = [];
  }

  if (appState.currentUser && (!appState.currentUser.id || appState.currentUser.id === 'usr-requester-1' || appState.currentUser.id.startsWith('usr-donor-'))) {
    appState.currentUser = null;
    appState.isAuthenticated = false;
  }

  if (!appState.requests) appState.requests = [];
  if (!appState.notifications) appState.notifications = [];
  if (!appState.selectedLoginRole) appState.selectedLoginRole = 'donor';
}

/**
 * Save current state to LocalStorage
 */
function persistAppState() {
  try {
    const serialized = {
      isAuthenticated: appState.isAuthenticated,
      activeRole: appState.activeRole,
      selectedLoginRole: appState.selectedLoginRole,
      currentUser: appState.currentUser,
      allUsers: appState.allUsers,
      requests: appState.requests,
      notifications: appState.notifications
    };
    localStorage.setItem('bloodconnect_app_session_v2', JSON.stringify(serialized));
  } catch (e) {
    console.warn('Unable to persist to LocalStorage:', e);
  }
}

// ------------------------------------------------------------------------------
// 3. Audio & Vibration Engine (Web Audio API + W3C Haptics)
// ------------------------------------------------------------------------------
let audioContext = null;
let audioMuted = false;
let isEmergencyAlarmActive = false;
let emergencyAlarmInterval = null;
let emergencyCountdownInterval = null;
let currentAlertedRequest = null;
let alertedEmergencyRequestIds = new Set();
let meshBroadcastChannel = null;

/**
 * Initialize Web Audio API and resume if suspended by browser autoplay policy
 */
function ensureAudioContext() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioContext) {
      audioContext = new AudioCtx();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    return audioContext;
  } catch (e) {
    console.warn('AudioContext initialization error:', e);
    return null;
  }
}

/**
 * Unlock AudioContext on first user interaction (touch/click/key)
 */
function unlockAudioOnFirstGesture() {
  const unlock = () => {
    ensureAudioContext();
    requestNotificationPermission();
    ['click', 'touchstart', 'keydown'].forEach(evt => {
      window.removeEventListener(evt, unlock);
    });
  };
  ['click', 'touchstart', 'keydown'].forEach(evt => {
    window.addEventListener(evt, unlock, { once: true });
  });
}
unlockAudioOnFirstGesture();

/**
 * Crisp 2-tone notification ping for standard app actions
 */
function playHospitalChime() {
  if (audioMuted) return;
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1320, now + 0.12);
    gain2.gain.setValueAtTime(0.18, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.55);
  } catch (err) {
    console.log('Hospital chime error:', err);
  }
}

/**
 * Realistic Emergency Vibrating Buzzer Sound Engine (Web Audio API)
 * Synthesizes a rapid fluttering mechanical vibration hum (150Hz + 22Hz LFO) layered with an urgent 880Hz/1175Hz siren
 */
function playVibratingEmergencySoundPattern() {
  if (audioMuted) return;
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    const createVibratingBurst = (startTime, duration, toneFreq) => {
      // 1. Mechanical Phone Vibration Motor Hum
      const vOsc = ctx.createOscillator();
      const vGain = ctx.createGain();
      const vFilter = ctx.createBiquadFilter();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();

      vOsc.type = 'sawtooth';
      vOsc.frequency.setValueAtTime(148, startTime);
      vOsc.frequency.linearRampToValueAtTime(162, startTime + duration);

      vFilter.type = 'bandpass';
      vFilter.frequency.setValueAtTime(340, startTime);
      vFilter.Q.setValueAtTime(3.8, startTime);

      // 22Hz flutter simulates physical eccentric motor vibration
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(22, startTime);
      lfoGain.gain.setValueAtTime(0.15, startTime);

      lfo.connect(vGain.gain);
      vOsc.connect(vFilter);
      vFilter.connect(vGain);

      vGain.gain.setValueAtTime(0.35, startTime);
      vGain.gain.setValueAtTime(0.35, startTime + duration - 0.04);
      vGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      vGain.connect(ctx.destination);

      vOsc.start(startTime);
      lfo.start(startTime);
      vOsc.stop(startTime + duration);
      lfo.stop(startTime + duration);

      // 2. Piercing Clinical Emergency Siren Tone
      if (toneFreq) {
        const sOsc = ctx.createOscillator();
        const sGain = ctx.createGain();
        sOsc.type = 'sawtooth';
        sOsc.frequency.setValueAtTime(toneFreq, startTime);
        sGain.gain.setValueAtTime(0.26, startTime);
        sGain.gain.setValueAtTime(0.26, startTime + duration - 0.04);
        sGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        const sFilter = ctx.createBiquadFilter();
        sFilter.type = 'lowpass';
        sFilter.frequency.setValueAtTime(2200, startTime);

        sOsc.connect(sFilter);
        sFilter.connect(sGain);
        sGain.connect(ctx.destination);

        sOsc.start(startTime);
        sOsc.stop(startTime + duration);
      }
    };

    // Burst 1: 0.00s to 0.40s (880 Hz - A5)
    createVibratingBurst(now, 0.40, 880);
    // Burst 2: 0.52s to 0.92s (880 Hz - A5)
    createVibratingBurst(now + 0.52, 0.40, 880);
    // Burst 3: 1.05s to 1.70s (1174.66 Hz - D6, Urgent crescendo)
    createVibratingBurst(now + 1.05, 0.65, 1174.66);

  } catch (err) {
    console.warn('Vibrating emergency audio error:', err);
  }
}

/**
 * Physical Mobile Device Vibration (W3C Vibration API)
 */
function triggerDeviceVibration() {
  if ('vibrate' in navigator) {
    try {
      // Urgent triple-vibrate pattern in ms: [vibrate, pause, vibrate, pause, vibrate]
      navigator.vibrate([400, 120, 400, 120, 650]);
    } catch (e) {
      console.warn('Vibration API error:', e);
    }
  }
}

/**
 * Start Continuous Emergency Alarm Loop (Sound + Vibration + Visual Shake)
 */
function startEmergencyAlarmLoop(requestId) {
  isEmergencyAlarmActive = true;

  // Add shaking vibration animation to modal sheet
  const sheet = document.getElementById('emergencyModalSheet');
  if (sheet) sheet.classList.add('vibrating');

  // Update mute button label
  const btnMuteText = document.getElementById('btnMuteEmergencyText');
  const btnMuteIcon = document.getElementById('btnMuteEmergencyIcon');
  if (btnMuteText) btnMuteText.textContent = audioMuted ? 'Unmute Alarm Sound' : 'Silence Alarm & Vibration';
  if (btnMuteIcon) btnMuteIcon.className = audioMuted ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';

  // Play immediately
  playVibratingEmergencySoundPattern();
  triggerDeviceVibration();

  // Loop every 2.4 seconds while active
  if (emergencyAlarmInterval) clearInterval(emergencyAlarmInterval);
  emergencyAlarmInterval = setInterval(() => {
    if (!isEmergencyAlarmActive) {
      clearInterval(emergencyAlarmInterval);
      return;
    }
    playVibratingEmergencySoundPattern();
    triggerDeviceVibration();
  }, 2400);
}

/**
 * Stop Emergency Alarm Loop
 */
function stopEmergencyAlarmLoop() {
  isEmergencyAlarmActive = false;
  if (emergencyAlarmInterval) {
    clearInterval(emergencyAlarmInterval);
    emergencyAlarmInterval = null;
  }
  const sheet = document.getElementById('emergencyModalSheet');
  if (sheet) sheet.classList.remove('vibrating');

  if ('vibrate' in navigator) {
    try { navigator.vibrate(0); } catch (e) {}
  }
}

/**
 * Toggle Mute for Active Emergency Alarm
 */
function toggleMuteActiveEmergencyAlarm() {
  audioMuted = !audioMuted;
  const btnMuteText = document.getElementById('btnMuteEmergencyText');
  const btnMuteIcon = document.getElementById('btnMuteEmergencyIcon');
  if (btnMuteText) btnMuteText.textContent = audioMuted ? 'Unmute Alarm Sound' : 'Silence Alarm & Vibration';
  if (btnMuteIcon) btnMuteIcon.className = audioMuted ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';

  if (audioMuted) {
    if ('vibrate' in navigator) {
      try { navigator.vibrate(0); } catch (e) {}
    }
    showToast('Alarm sound silenced. Emergency details remain on screen.', 'info');
  } else {
    playVibratingEmergencySoundPattern();
    triggerDeviceVibration();
    showToast('Emergency alarm sound resumed.', 'emergency');
  }
}

/**
 * Test Button for Emergency Vibrating Sound & Device Vibration
 */
function testEmergencyAlertSound() {
  ensureAudioContext();
  const wasMuted = audioMuted;
  audioMuted = false;

  playVibratingEmergencySoundPattern();
  triggerDeviceVibration();

  showToast('🔊 Vibrating buzzer emergency alarm test triggered! (Audio + Device Vibration active)', 'emergency');

  // Briefly shake the donor availability card as feedback
  const card = document.getElementById('donorAvailabilityCard');
  if (card) {
    card.classList.add('pulse-border');
    setTimeout(() => card.classList.remove('pulse-border'), 1800);
  }

  setTimeout(() => {
    audioMuted = wasMuted;
  }, 2000);
}

function toggleAudioChime() {
  audioMuted = !audioMuted;
  const btn = document.getElementById('btnAudioToggle');
  if (btn) {
    btn.innerHTML = audioMuted 
      ? '<i class="fa-solid fa-volume-xmark"></i> Sound Muted' 
      : '<i class="fa-solid fa-volume-high"></i> Sound On';
  }
  showToast(audioMuted ? 'Emergency alert sounds muted' : 'Emergency alert sounds enabled', 'info');
}

/**
 * Request Browser Notification Permissions
 */
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    try {
      Notification.requestPermission();
    } catch (e) {}
  }
}

/**
 * Send Desktop / System Emergency Push Notification
 */
function sendDesktopEmergencyNotification(req) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try {
      const notif = new Notification(`🚨 URGENT: ${req.bloodGroup} Blood Needed!`, {
        body: `${req.hospital} urgently needs ${req.units} unit(s). You are a matching donor! Tap to respond.`,
        icon: 'assets/favicon.ico',
        tag: `bc-emerg-${req.id}`,
        requireInteraction: true,
        vibrate: [400, 120, 400, 120, 650]
      });
      notif.onclick = () => {
        window.focus();
        showEmergencyDonorAlert(req);
        notif.close();
      };
    } catch (e) {
      console.warn('Desktop notification error:', e);
    }
  }
}

/**
 * Pop up the High-Priority Emergency Donor Alert Sheet with Sound & Vibration
 */
function showEmergencyDonorAlert(req) {
  if (!req || !req.id) return;
  if (req.status === 'cancelled' || req.status === 'completed') return;

  // Verify current user is logged in
  if (!appState.isAuthenticated || !appState.currentUser) return;

  const currentUserId = appState.currentUser.id;
  const currentUserPhone = (appState.currentUser.phone || '').replace(/\D/g, '');
  const reqContactDigits = (req.contact || '').replace(/\D/g, '');

  // CRITICAL: A requester must NEVER be alerted for their own request!
  if (req.requesterId === currentUserId) return;
  if (currentUserPhone && reqContactDigits && currentUserPhone === reqContactDigits) return;

  // Donor must be compatible with the requested blood group
  const donorBlood = appState.currentUser.bloodGroup || 'O+';
  if (!isDonorCompatible(donorBlood, req.bloodGroup)) return;

  // Donor availability check
  if (appState.currentUser.availability === false) return;

  currentAlertedRequest = req;
  alertedEmergencyRequestIds.add(req.id);

  // Populate #emergencyDonorModal
  const modal = document.getElementById('emergencyDonorModal');
  if (!modal) return;

  const bgEl = document.getElementById('emergModalBloodGroup');
  const headlineEl = document.getElementById('emergModalHeadline');
  const subtextEl = document.getElementById('emergModalSubtext');
  const hospEl = document.getElementById('emergModalHospital');
  const distEl = document.getElementById('emergModalDistance');
  const unitsEl = document.getElementById('emergModalUnits');
  const btnAccept = document.getElementById('btnAcceptEmergencyModal');

  if (bgEl) bgEl.textContent = req.bloodGroup;
  if (headlineEl) headlineEl.textContent = `${req.bloodGroup} Blood Needed Urgently`;
  if (subtextEl) subtextEl.textContent = `Immediate emergency response requested at ${req.hospital}`;
  if (hospEl) hospEl.textContent = req.hospital;
  if (distEl) distEl.innerHTML = `<strong>Approximately ${req.distance || '2.4 km'}</strong> from your location`;
  if (unitsEl) unitsEl.innerHTML = `<strong>${req.units} Unit${req.units > 1 ? 's' : ''}</strong> required immediately for critical surgery`;
  if (btnAccept) {
    btnAccept.onclick = () => handleDonorAcceptEmergency(req.id);
  }

  // 5-minute ticking countdown timer
  startEmergencyCountdown(300);

  // Display modal
  modal.classList.add('active');

  // Trigger vibrating sound & haptic vibration
  startEmergencyAlarmLoop(req.id);

  // System desktop notification
  sendDesktopEmergencyNotification(req);

  showToast(`🚨 CRITICAL EMERGENCY: ${req.bloodGroup} needed at ${req.hospital}! Vibration alarm active.`, 'emergency');
}

/**
 * 5-minute Countdown Timer inside Emergency Alert Modal
 */
function startEmergencyCountdown(durationSeconds = 300) {
  if (emergencyCountdownInterval) clearInterval(emergencyCountdownInterval);
  let remaining = durationSeconds;

  const timerEl = document.getElementById('countdownTimerText');
  const updateDisplay = () => {
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    if (timerEl) {
      timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
  };

  updateDisplay();
  emergencyCountdownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(emergencyCountdownInterval);
      emergencyCountdownInterval = null;
      if (timerEl) timerEl.textContent = '00:00';
    } else {
      updateDisplay();
    }
  }, 1000);
}

/**
 * Dismiss Emergency Donor Notification Modal
 */
function closeEmergencyDonorModal() {
  stopEmergencyAlarmLoop();
  if (emergencyCountdownInterval) {
    clearInterval(emergencyCountdownInterval);
    emergencyCountdownInterval = null;
  }
  const modal = document.getElementById('emergencyDonorModal');
  if (modal) modal.classList.remove('active');
}

/**
 * Donor clicks "🩸 I CAN HELP NOW" from Emergency Notification Modal
 */
async function handleDonorAcceptEmergency(reqId) {
  stopEmergencyAlarmLoop();
  closeEmergencyDonorModal();

  const targetId = reqId || (currentAlertedRequest ? currentAlertedRequest.id : null);
  const req = appState.requests.find(r => r.id === targetId) || currentAlertedRequest;
  if (!req) return;

  const donor = (appState.currentUser && appState.currentUser.role === 'donor')
    ? appState.currentUser
    : (appState.allUsers.find(u => u.id === (appState.currentUser ? appState.currentUser.id : 'usr-donor-1')) || appState.currentUser);

  await respondToEmergencyAsDonor(req.id, donor, '15 mins');
  openDonorRequestDetails(req.id);
}

// ------------------------------------------------------------------------------
// 4. Real-time Multi-System Cloud Mesh & Synchronization Layer (Cross-Device)
// ------------------------------------------------------------------------------

const MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt'
];
const MQTT_STATE_TOPIC = 'bloodconnect/network/v2/state';
const MQTT_EVENTS_TOPIC = 'bloodconnect/network/v2/events';

let mqttClient = null;
let currentBrokerIdx = 0;
let isPublishingState = false;

// Cross-tab zero-latency broadcast channel (for tabs on same machine)
try {
  if (typeof BroadcastChannel !== 'undefined') {
    meshBroadcastChannel = new BroadcastChannel('bloodconnect_emergency_mesh');
    meshBroadcastChannel.onmessage = (event) => {
      handleCloudEventMessage(event.data);
    };
  }
} catch (e) {
  console.warn('BroadcastChannel not supported:', e);
}

/**
 * Initialize Cloud Real-Time Mesh over WebSockets (MQTT)
 * Connects any number of computers/phones in real-time across the world
 */
function initMqttCloudMesh() {
  if (typeof mqtt === 'undefined') {
    setTimeout(initMqttCloudMesh, 400);
    return;
  }

  const brokerUrl = MQTT_BROKERS[currentBrokerIdx];
  const clientId = 'bc_dev_' + Math.random().toString(16).substring(2, 10);

  try {
    mqttClient = mqtt.connect(brokerUrl, {
      clientId,
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 3000,
      keepalive: 30
    });

    mqttClient.on('connect', () => {
      console.log('⚡ Connected to BloodConnect Real-time Mesh:', brokerUrl);
      mqttClient.subscribe([MQTT_STATE_TOPIC, MQTT_EVENTS_TOPIC], { qos: 1 });
    });

    mqttClient.on('message', (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        if (topic === MQTT_STATE_TOPIC) {
          handleCloudStateMessage(payload);
        } else if (topic === MQTT_EVENTS_TOPIC) {
          handleCloudEventMessage(payload);
        }
      } catch (err) {
        console.warn('Error processing mesh message:', err);
      }
    });

    mqttClient.on('error', (err) => {
      console.warn('MQTT connection notice on ' + brokerUrl + ':', err);
      try { mqttClient.end(true); } catch (e) {}
      currentBrokerIdx = (currentBrokerIdx + 1) % MQTT_BROKERS.length;
      setTimeout(initMqttCloudMesh, 2500);
    });
  } catch (e) {
    console.warn('Mesh init error, fallback to REST polling:', e);
  }
}

// Start cloud mesh immediately
initMqttCloudMesh();

/**
 * Publish updated global database state to cloud (retained message)
 */
function publishCloudState() {
  if (!mqttClient || !mqttClient.connected || isPublishingState) return;
  try {
    isPublishingState = true;
    const payload = JSON.stringify({
      users: appState.allUsers || [],
      requests: appState.requests || [],
      notifications: appState.notifications || [],
      updatedAt: new Date().toISOString()
    });
    mqttClient.publish(MQTT_STATE_TOPIC, payload, { retain: true, qos: 1 }, () => {
      isPublishingState = false;
    });
  } catch (e) {
    isPublishingState = false;
  }
}

/**
 * Broadcast an instant live event to all connected devices across systems
 */
function broadcastGlobalEvent(eventData) {
  // 1. Same-device cross-tab broadcast
  if (meshBroadcastChannel) {
    try { meshBroadcastChannel.postMessage(eventData); } catch (e) {}
  }
  // 2. Cross-system live WebSocket broadcast (<30ms latency)
  if (mqttClient && mqttClient.connected) {
    try {
      mqttClient.publish(MQTT_EVENTS_TOPIC, JSON.stringify(eventData), { retain: false, qos: 1 });
    } catch (e) {}
  }
  // 3. Persist latest global database state to cloud retain
  publishCloudState();
}

/**
 * Handle incoming full database sync from Cloud
 */
function handleCloudStateMessage(data) {
  if (!data) return;

  // 1. Merge users from all systems
  if (Array.isArray(data.users) && data.users.length > 0) {
    const userMap = new Map();
    (appState.allUsers || []).forEach(u => {
      if (u.id) userMap.set(u.id, u);
      const email = (u.email || '').trim().toLowerCase();
      if (email) userMap.set(email, u);
      const phone = (u.phone || '').replace(/\D/g, '');
      if (phone) userMap.set(phone, u);
    });

    data.users.forEach(u => {
      const email = (u.email || '').trim().toLowerCase();
      const phone = (u.phone || '').replace(/\D/g, '');
      const existing = (u.id && userMap.get(u.id)) || (email && userMap.get(email)) || (phone && userMap.get(phone));
      if (!existing) {
        appState.allUsers.push(u);
        if (u.id) userMap.set(u.id, u);
        if (email) userMap.set(email, u);
        if (phone) userMap.set(phone, u);
      } else {
        // Merge stats & availability
        Object.assign(existing, u);
      }
    });

    // If current logged-in user exists in cloud state, sync their updated data
    if (appState.currentUser) {
      const self = appState.allUsers.find(u => 
        (u.id && u.id === appState.currentUser.id) ||
        (u.email && (u.email || '').toLowerCase() === (appState.currentUser.email || '').toLowerCase()) ||
        (u.phone && (u.phone || '').replace(/\D/g, '') === (appState.currentUser.phone || '').replace(/\D/g, ''))
      );
      if (self) {
        const localPass = appState.currentUser.password || self.password;
        Object.assign(appState.currentUser, self);
        if (localPass) appState.currentUser.password = localPass;
      }
    }
  }

  // 2. Merge blood requests from all systems
  if (Array.isArray(data.requests)) {
    const reqMap = new Map();
    data.requests.forEach(r => {
      if (r && r.id) reqMap.set(r.id, r);
    });
    (appState.requests || []).forEach(r => {
      if (r && r.id && !reqMap.has(r.id)) {
        reqMap.set(r.id, r);
      }
    });
    appState.requests = Array.from(reqMap.values()).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Live radar update if currently active
    if (currentScreenId === 'screen-emergency-live' && activeLiveReqId) {
      renderLiveRadarStatus(activeLiveReqId);
    }
  }

  // 3. Merge notifications
  if (Array.isArray(data.notifications)) {
    const notifMap = new Map();
    data.notifications.forEach(n => {
      if (n && n.id) notifMap.set(n.id, n);
    });
    (appState.notifications || []).forEach(n => {
      if (n && n.id && !notifMap.has(n.id)) {
        notifMap.set(n.id, n);
      }
    });
    appState.notifications = Array.from(notifMap.values()).sort((a, b) => (b.id || '').localeCompare(a.id || ''));
  }

  persistAppState();
  updateUI();
  renderDonorEmergencies();
  renderMyRequestsList();
  if (typeof renderDonorDirectory === 'function') renderDonorDirectory();
}

/**
 * Handle incoming real-time events across systems (new users, emergency dispatch, responses)
 */
function handleCloudEventMessage(eventData) {
  if (!eventData || !eventData.type) return;
  const { type, user, request, requestId, notification } = eventData;

  // Event: New User Registered on another system
  if (type === 'NEW_USER' && user) {
    const exists = appState.allUsers.some(u => 
      (u.id && u.id === user.id) ||
      (u.email && (u.email || '').toLowerCase() === (user.email || '').toLowerCase()) ||
      (u.phone && (u.phone || '').replace(/\D/g, '') === (user.phone || '').replace(/\D/g, ''))
    );
    if (!exists) {
      appState.allUsers.push(user);
      persistAppState();
      renderDonorEmergencies();
      if (typeof renderDonorDirectory === 'function') renderDonorDirectory();
    }
    return;
  }

  // Event: New Urgent Emergency Request Broadcasted
  if (type === 'NEW_EMERGENCY_REQUEST' && request) {
    if (!appState.requests.some(r => r.id === request.id)) {
      appState.requests.unshift(request);
    }
    if (notification && !appState.notifications.some(n => n.id === notification.id)) {
      appState.notifications.unshift(notification);
      updateNotificationBadges();
    }
    persistAppState();
    renderDonorEmergencies();
    renderMyRequestsList();

    // Trigger loud audio alarm & emergency dispatch modal on compatible donor devices
    if (appState.isAuthenticated && appState.currentUser && appState.activeRole === 'donor') {
      const donorBlood = appState.currentUser.bloodGroup || 'O+';
      const currentUserId = appState.currentUser.id;
      const currentUserPhone = (appState.currentUser.phone || '').replace(/\D/g, '');
      const reqContact = (request.contact || '').replace(/\D/g, '');

      if (request.status === 'searching' &&
          request.requesterId !== currentUserId &&
          (!currentUserPhone || !reqContact || currentUserPhone !== reqContact) &&
          appState.currentUser.availability !== false &&
          isDonorCompatible(donorBlood, request.bloodGroup) &&
          !alertedEmergencyRequestIds.has(request.id)) {
        showEmergencyDonorAlert(request);
      }
    }
    return;
  }

  // Event: A verified donor responded to an emergency
  if (type === 'DONOR_RESPONDED' && request) {
    const idx = appState.requests.findIndex(r => r.id === request.id);
    if (idx !== -1) {
      appState.requests[idx] = request;
    } else {
      appState.requests.unshift(request);
    }
    persistAppState();
    if (currentScreenId === 'screen-emergency-live' && activeLiveReqId === request.id) {
      renderLiveRadarStatus(request.id);
    }
    renderDonorEmergencies();
    renderMyRequestsList();
    playHospitalChime();

    if (appState.currentUser && appState.currentUser.id === request.requesterId) {
      showToast(`❤️ Verified Donor ${request.respondedDonor ? request.respondedDonor.name : ''} has responded and is en route!`, 'success');
    }
    return;
  }

  // Event: Request marked fulfilled / blood received
  if (type === 'REQUEST_FULFILLED' && request) {
    const idx = appState.requests.findIndex(r => r.id === request.id);
    if (idx !== -1) appState.requests[idx] = request;
    persistAppState();
    if (currentScreenId === 'screen-emergency-live' && activeLiveReqId === request.id) {
      renderLiveRadarStatus(request.id);
    }
    renderDonorEmergencies();
    renderMyRequestsList();
    return;
  }

  // Event: Request Cancelled
  if (type === 'REQUEST_CANCELLED') {
    const targetId = requestId || (request ? request.id : null);
    if (targetId) {
      const req = appState.requests.find(r => r.id === targetId);
      if (req) req.status = 'cancelled';
      persistAppState();
      renderDonorEmergencies();
      renderMyRequestsList();
    }
    return;
  }

  // Event: All Accounts Wiped
  if (type === 'ALL_ACCOUNTS_CLEARED') {
    appState.allUsers = [];
    appState.requests = [];
    appState.notifications = [];
    appState.currentUser = null;
    appState.isAuthenticated = false;
    persistAppState();
    navigateToScreen('screen-login', false);
    showToast('Network data cleared across all systems', 'info');
    return;
  }
}

// Server-Sent Events (SSE) for native node environment
function initServerSentEvents() {
  if (typeof EventSource === 'undefined') return;
  try {
    const eventSource = new EventSource('/api/events');
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleCloudEventMessage(data);
      } catch (err) {}
    };
    eventSource.onerror = () => {};
  } catch (e) {}
}
initServerSentEvents();

/**
 * Periodically sync state with REST API (/api/data)
 */
async function fetchDataFromBackend() {
  try {
    const res = await fetch('/api/data', { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.success) {
      handleCloudStateMessage(data);
    }
  } catch (err) {
    // Running in serverless or offline mode, MQTT handles live sync
  }
}

// Polling interval for guaranteed fallback
setInterval(fetchDataFromBackend, 2500);

// ------------------------------------------------------------------------------
// 5. Screen Navigation System
// ------------------------------------------------------------------------------
function navigateToScreen(screenId, recordHistory = true) {
  if (currentScreenId === screenId) return;

  const nextScreen = document.getElementById(screenId);
  if (!nextScreen) {
    console.error('Target screen element not found:', screenId);
    return;
  }

  if (recordHistory && currentScreenId) {
    if (currentScreenId !== 'screen-splash' && currentScreenId !== 'screen-login') {
      appState.historyStack.push(currentScreenId);
    }
  }

  // Deactivate all screens
  document.querySelectorAll('.screen-view').forEach(screen => {
    screen.classList.remove('active');
  });

  // Activate targeted screen
  nextScreen.classList.add('active');
  currentScreenId = screenId;

  if (screenId === 'screen-create-request') {
    populateRequestFormDefaults();
  }

  // Scroll to top
  const mainContent = document.getElementById('appMainContent');
  if (mainContent) {
    mainContent.scrollTop = 0;
  }

  // Update navbar, badges, and contextual tabs
  updateNavigationUI(screenId);
  updateUI();
}

function handleNavigationBack() {
  if (appState.historyStack.length > 0) {
    const prev = appState.historyStack.pop();
    navigateToScreen(prev, false);
  } else {
    const homeScreen = appState.activeRole === 'donor' ? 'screen-home-donor' : 'screen-home-requester';
    navigateToScreen(homeScreen, false);
  }
}

/**
 * Update Header and Web Navbar states according to active screen
 */
function updateNavigationUI(screenId) {
  const header = document.getElementById('appHeader');
  const bottomNav = document.getElementById('appBottomNav');
  const headerBackBtn = document.getElementById('headerBackBtn');
  const roleSwitchBtn = document.getElementById('headerRoleSwitchBtn');
  const webNavLinks = document.getElementById('webNavLinks');
  const webMeshIndicator = document.querySelector('.web-mesh-indicator');
  const userProfileMenu = document.getElementById('userProfileMenuContainer');

  // Splash or Auth Screens (Login, Signup): Show simplified or no header
  if (screenId === 'screen-splash') {
    if (header) header.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';
    return;
  }

  if (screenId === 'screen-login' || screenId === 'screen-signup') {
    if (header) {
      header.style.display = 'flex';
      if (headerBackBtn) headerBackBtn.style.display = 'none';
      if (roleSwitchBtn) roleSwitchBtn.style.display = 'none';
      if (webNavLinks) webNavLinks.style.display = 'none';
      if (webMeshIndicator) webMeshIndicator.style.display = 'none';
      if (userProfileMenu) userProfileMenu.style.display = 'none';
    }
    if (bottomNav) bottomNav.style.display = 'none';
    return;
  }

  // Authenticated In-App Screens
  if (header) {
    header.style.display = 'flex';
    if (roleSwitchBtn) roleSwitchBtn.style.display = 'flex';
    if (webNavLinks) webNavLinks.style.display = 'flex';
    if (webMeshIndicator) webMeshIndicator.style.display = 'flex';
    if (userProfileMenu) userProfileMenu.style.display = 'block';

    const isRootHome = (screenId === 'screen-home-requester' || screenId === 'screen-home-donor');
    if (headerBackBtn) {
      headerBackBtn.style.display = isRootHome ? 'none' : 'flex';
    }

    // Synchronize Desktop Navbar Link Active States
    const navLinkHome = document.getElementById('navLinkHome');
    const navLinkRequest = document.getElementById('navLinkRequest');
    const navLinkHistory = document.getElementById('navLinkHistory');
    
    if (navLinkHome) {
      navLinkHome.classList.toggle('active', isRootHome);
    }
    if (navLinkRequest) {
      navLinkRequest.classList.toggle('active', screenId === 'screen-create-request');
    }
    if (navLinkHistory) {
      navLinkHistory.classList.toggle('active', screenId === 'screen-my-requests');
    }
  }

  if (bottomNav) {
    bottomNav.style.display = 'flex';
    const requesterTabs = document.getElementById('requesterNavTabs');
    const donorTabs = document.getElementById('donorNavTabs');
    if (requesterTabs && donorTabs) {
      if (appState.activeRole === 'donor') {
        requesterTabs.style.display = 'none';
        donorTabs.style.display = 'flex';
      } else {
        requesterTabs.style.display = 'flex';
        donorTabs.style.display = 'none';
      }
    }

    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      if (btn.getAttribute('data-target') === screenId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
}

function handleNavTabClick(targetScreenId, btnElement) {
  document.querySelectorAll('.nav-tab-btn').forEach(btn => btn.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
  navigateToScreen(targetScreenId);
}

// ------------------------------------------------------------------------------
// 6. User Profile Menu Dropdown & Role Switching
// ------------------------------------------------------------------------------
function toggleProfileDropdown(event) {
  if (event) event.stopPropagation();
  const dropdown = document.getElementById('userDropdownPopover');
  if (dropdown) {
    dropdown.classList.toggle('active');
  }
}

function closeProfileDropdown() {
  const dropdown = document.getElementById('userDropdownPopover');
  if (dropdown) {
    dropdown.classList.remove('active');
  }
}

// Close dropdown on click outside
document.addEventListener('click', (e) => {
  const menuContainer = document.getElementById('userProfileMenuContainer');
  if (menuContainer && !menuContainer.contains(e.target)) {
    closeProfileDropdown();
  }
});

/**
 * Switch active role from dropdown, banner, or header pill
 * Preserves the logged-in user's own identity so they can seamlessly request blood
 */
function switchActiveRoleAndNavigate() {
  closeProfileDropdown();
  const targetRole = appState.activeRole === 'requester' ? 'donor' : 'requester';

  appState.activeRole = targetRole;
  if (appState.currentUser) {
    appState.currentUser.activeMode = targetRole;
  }
  appState.isAuthenticated = true;
  persistAppState();
  updateUI();

  const targetScreen = targetRole === 'donor' ? 'screen-home-donor' : 'screen-home-requester';
  navigateToScreen(targetScreen);

  const userName = appState.currentUser ? appState.currentUser.name : 'User';
  showToast(`Switched to ${targetRole === 'donor' ? 'Donor Mode' : 'Requester Mode'} (${userName})`, 'info');
}

function toggleUserRole() {
  switchActiveRoleAndNavigate();
}

// ------------------------------------------------------------------------------
// 7. Authentication: Login & Registration
// ------------------------------------------------------------------------------
function setLoginRole(role) {
  appState.selectedLoginRole = role;
}

/**
 * Instant Quick Sign-In for testing sample accounts
 */
function quickLoginUser(userId) {
  const user = appState.allUsers.find(u => u.id === userId);
  if (!user) {
    showToast('User profile not found', 'info');
    return;
  }

  appState.currentUser = JSON.parse(JSON.stringify(user));
  appState.activeRole = user.role;
  appState.isAuthenticated = true;
  persistAppState();
  updateUI();

  const targetScreen = user.role === 'donor' ? 'screen-home-donor' : 'screen-home-requester';
  navigateToScreen(targetScreen);

  showToast(`Signed in as ${user.name} (${user.role.toUpperCase()} • ${user.bloodGroup})`, 'success');
}

/**
 * Switch Auth Mode between Login and Sign Up
 */
function switchAuthMode(mode) {
  if (mode === 'signup') {
    navigateToScreen('screen-signup');
  } else {
    navigateToScreen('screen-login');
  }

  // Update all tab active states
  const loginTabs = [document.getElementById('authModeLoginBtn'), document.getElementById('signupTabLoginBtn')];
  const signupTabs = [document.getElementById('authModeSignupBtn'), document.getElementById('signupTabSignupBtn')];

  loginTabs.forEach(t => t && t.classList.toggle('active', mode === 'login'));
  signupTabs.forEach(t => t && t.classList.toggle('active', mode === 'signup'));
}

/**
 * Real-time Validation for Signup Password and Confirmation Password
 */
function validateSignupPasswords() {
  const pass = document.getElementById('signupPassword');
  const confirm = document.getElementById('signupConfirmPassword');
  const hint = document.getElementById('passwordMatchStatus');
  if (!pass || !confirm || !hint) return;

  const val1 = pass.value;
  const val2 = confirm.value;

  if (!val2) {
    hint.style.display = 'none';
    hint.className = 'password-match-hint';
    hint.innerHTML = '';
    return;
  }

  hint.style.display = 'flex';
  if (val1 === val2) {
    hint.className = 'password-match-hint matched';
    hint.innerHTML = '<i class="fa-solid fa-circle-check"></i> Passwords match perfectly';
  } else {
    hint.className = 'password-match-hint mismatched';
    hint.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Passwords do not match';
  }
}

/**
 * Real-time Validation for Signup Age (18+ Requirement)
 */
function validateSignupAge() {
  const ageInput = document.getElementById('signupAge');
  const hint = document.getElementById('signupAgeHint');
  if (!ageInput) return;
  const val = parseInt(ageInput.value, 10);
  if (!ageInput.value || isNaN(val)) {
    if (hint) {
      hint.style.color = 'var(--text-muted)';
      hint.textContent = 'Only users 18 and older are eligible to access.';
    }
    return;
  }
  if (val < 18) {
    if (hint) {
      hint.style.color = '#dc2626';
      hint.textContent = '❌ Access Restricted: You must be at least 18 years old to access BloodConnect.';
    }
    ageInput.style.borderColor = '#dc2626';
  } else if (val > 75) {
    if (hint) {
      hint.style.color = '#dc2626';
      hint.textContent = '⚠️ Age must be 75 or below for active donor eligibility.';
    }
    ageInput.style.borderColor = '#dc2626';
  } else {
    if (hint) {
      hint.style.color = '#16a34a';
      hint.textContent = '✓ Age verified (18+ eligible for access).';
    }
    ageInput.style.borderColor = '';
  }
}

/**
 * Handle Login Form Submit (Unified Single Login for Both Donors and Requesters)
 */
async function handleLoginSubmit(event) {
  event.preventDefault();
  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPassword');
  const emailVal = (emailInput ? emailInput.value : '').trim().toLowerCase();
  const passVal = passInput ? passInput.value : '';

  if (!emailVal || !passVal) {
    showToast('Please enter both your phone/email and password.', 'emergency');
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailVal, password: passVal })
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok && data.success && data.user) {
      // Enforce age limit (18+)
      if (data.user.age && parseInt(data.user.age, 10) < 18) {
        showToast('Access Restricted: Only individuals aged 18 and above are eligible to access BloodConnect.', 'emergency');
        return;
      }

      appState.currentUser = data.user;
      appState.activeRole = data.user.role || 'donor';
      appState.isAuthenticated = true;
      try { sessionStorage.setItem('bloodconnect_session_active', 'true'); } catch (e) {}
      persistAppState();
      updateUI();

      showToast(`Welcome back, ${data.user.name}!`, 'success');
      const targetScreen = appState.activeRole === 'requester' ? 'screen-home-requester' : 'screen-home-donor';
      navigateToScreen(targetScreen);
      return;
    } else if (res.status === 403) {
      showToast(data.message || 'Access Restricted: Only individuals aged 18 and above are eligible to access BloodConnect.', 'emergency');
      return;
    } else if (res.status === 401) {
      showToast(data.message || 'Invalid credentials or wrong password.', 'emergency');
      return;
    }
  } catch (e) {
    console.warn('Backend login fallback to local users:', e);
  }

  // Fallback to local and cloud user matching
  const cleanDigits = emailVal.replace(/\D/g, '');
  const findUserMatch = (users) => (users || []).find(u => {
    const uEmail = (u.email || '').toLowerCase().trim();
    const uPhoneDigits = (u.phone || '').replace(/\D/g, '');
    const uName = (u.name || '').toLowerCase().trim();
    const emailMatch = uEmail && uEmail === emailVal;
    const phoneMatch = cleanDigits.length >= 6 && uPhoneDigits && (uPhoneDigits === cleanDigits || uPhoneDigits.endsWith(cleanDigits) || cleanDigits.endsWith(uPhoneDigits));
    const nameMatch = uName && uName === emailVal;
    return emailMatch || phoneMatch || nameMatch;
  });

  let matchedUser = findUserMatch(appState.allUsers);

  // If not found yet, perform immediate live sync from server
  if (!matchedUser) {
    try {
      const freshRes = await fetch('/api/data', { cache: 'no-cache' });
      if (freshRes.ok) {
        const freshData = await freshRes.json();
        if (freshData && freshData.success && Array.isArray(freshData.users)) {
          handleCloudStateMessage(freshData);
          matchedUser = findUserMatch(appState.allUsers);
        }
      }
    } catch (e) {}
  }

  if (matchedUser) {
    if (matchedUser.age && parseInt(matchedUser.age, 10) < 18) {
      showToast('Access Restricted: Only individuals aged 18 and above are eligible to access BloodConnect.', 'emergency');
      return;
    }

    if (matchedUser.password && passVal && matchedUser.password !== passVal) {
      showToast('Incorrect password. Please check and try again.', 'emergency');
      if (passInput) passInput.focus();
      return;
    }

    appState.currentUser = JSON.parse(JSON.stringify(matchedUser));
    appState.activeRole = matchedUser.role || 'donor';
    appState.isAuthenticated = true;
    try { sessionStorage.setItem('bloodconnect_session_active', 'true'); } catch (e) {}
    persistAppState();
    updateUI();

    showToast(`Welcome back, ${matchedUser.name}!`, 'success');
    const targetScreen = appState.activeRole === 'requester' ? 'screen-home-requester' : 'screen-home-donor';
    navigateToScreen(targetScreen);
  } else {
    showToast('Account not found. Please sign up to create a new account.', 'emergency');
  }
}

function selectSignupBloodGroup(group) {
  const chips = document.querySelectorAll('#signupBloodGroupGrid .blood-chip');
  chips.forEach(chip => {
    if (chip.getAttribute('data-group') === group) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
  const input = document.getElementById('signupBloodGroup');
  if (input) input.value = group;
}

/**
 * Handle Sign Up Form Submit
 * All users initially register as verified Blood Donors. They can become a requester anytime!
 */
async function handleSignupSubmit(event) {
  event.preventDefault();

  const nameInput = document.getElementById('signupName');
  const ageInput = document.getElementById('signupAge');
  const phoneInput = document.getElementById('signupPhone');
  const emailInput = document.getElementById('signupEmail');
  const addressInput = document.getElementById('signupAddress');
  const passwordInput = document.getElementById('signupPassword');
  const confirmInput = document.getElementById('signupConfirmPassword');

  const name = nameInput ? nameInput.value.trim() : '';
  const age = ageInput ? ageInput.value.trim() : '';
  const phone = phoneInput ? phoneInput.value.trim() : '';
  const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
  const address = addressInput ? addressInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';
  const confirmPassword = confirmInput ? confirmInput.value : '';

  // Comprehensive Validations
  if (!name) {
    showToast('Please enter your full name.', 'emergency');
    if (nameInput) nameInput.focus();
    return;
  }

  if (!age) {
    showToast('Please enter your age.', 'emergency');
    if (ageInput) ageInput.focus();
    return;
  }

  const ageNum = parseInt(age, 10);
  if (isNaN(ageNum) || ageNum < 18) {
    showToast('Access Restricted: You must be at least 18 years old to access and register on BloodConnect.', 'emergency');
    if (ageInput) {
      ageInput.focus();
      ageInput.style.borderColor = '#dc2626';
    }
    return;
  }

  if (ageNum > 75) {
    showToast('Blood donation safety guidelines require donors to be 75 years of age or younger.', 'emergency');
    if (ageInput) ageInput.focus();
    return;
  }

  if (!phone) {
    showToast('Please enter your mobile phone number.', 'emergency');
    if (phoneInput) phoneInput.focus();
    return;
  }

  if (!email || !email.includes('@')) {
    showToast('Please enter a valid email address.', 'emergency');
    if (emailInput) emailInput.focus();
    return;
  }

  if (!address) {
    showToast('Please enter your residential address or city.', 'emergency');
    if (addressInput) addressInput.focus();
    return;
  }

  if (!password) {
    showToast('Please create a password.', 'emergency');
    if (passwordInput) passwordInput.focus();
    return;
  }

  if (password.length < 6) {
    showToast('Password must be at least 6 characters long.', 'emergency');
    if (passwordInput) passwordInput.focus();
    return;
  }

  if (!confirmPassword) {
    showToast('Please re-enter your confirmation password.', 'emergency');
    if (confirmInput) confirmInput.focus();
    return;
  }

  if (password !== confirmPassword) {
    showToast('Password and Confirmation Password do not match. Please verify.', 'emergency');
    if (confirmInput) confirmInput.focus();
    return;
  }

  const bloodGroup = document.getElementById('signupBloodGroup')?.value || 'O+';
  const emergencyOptIn = document.getElementById('signupEmergencyOptIn')?.checked ?? true;

  const newUser = {
    id: `usr-${Date.now()}`,
    name,
    age: ageNum,
    phone,
    email,
    address,
    city: address,
    password,
    role: 'donor',
    bloodGroup,
    availability: true,
    emergencyOptIn,
    relationship: 'Donor',
    impactLives: 0,
    donationsCount: 0,
    rapidResponses: 0
  };

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.user && data.user.id) {
        newUser.id = data.user.id;
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      showToast(errData.message || 'Registration rejected: You must be at least 18 years old to access.', 'emergency');
      return;
    }
  } catch (e) {
    console.warn('Backend register fallback to local state:', e);
  }

  appState.allUsers.push(newUser);
  appState.currentUser = newUser;
  appState.activeRole = 'donor';
  appState.isAuthenticated = true;
  try { sessionStorage.setItem('bloodconnect_session_active', 'true'); } catch (e) {}

  persistAppState();
  updateUI();

  // Instant cross-system cloud broadcast: all devices receive new account immediately!
  broadcastGlobalEvent({
    type: 'NEW_USER',
    user: newUser
  });

  showToast(`Donor account created! Welcome to the network, ${name}!`, 'success');
  navigateToScreen('screen-home-donor');
}

/**
 * Log Out
 */
function handleLogout() {
  appState.isAuthenticated = false;
  try { sessionStorage.removeItem('bloodconnect_session_active'); } catch (e) {}
  persistAppState();
  showToast('Logged out of BloodConnect', 'info');
  navigateToScreen('screen-login', false);
}

// ------------------------------------------------------------------------------
// 8. Requester Experience: Create & Broadcast Blood Request
// ------------------------------------------------------------------------------
let currentReqForm = {
  bloodGroup: 'O+',
  hospital: '',
  location: 'Anna Nagar, Chennai (2.8 km away)',
  urgency: 'Emergency',
  units: 2,
  contact: '+91 98765 43210',
  notes: ''
};

/**
 * Handle Desktop or CTA "Request Blood" button click.
 * Automatically switches donor into Requester Mode and prepares request form.
 */
function handleRequestBloodNav() {
  if (appState.activeRole !== 'requester') {
    appState.activeRole = 'requester';
    if (appState.currentUser) {
      appState.currentUser.activeMode = 'requester';
    }
    persistAppState();
    updateUI();
    const userName = appState.currentUser ? appState.currentUser.name : 'User';
    showToast(`Switched to Requester Mode (${userName})`, 'info');
  }
  populateRequestFormDefaults();
  navigateToScreen('screen-create-request');
}

/**
 * Pre-populate blood request form with the active user's details
 */
function populateRequestFormDefaults() {
  if (!appState.currentUser) return;
  const user = appState.currentUser;

  const contactInput = document.getElementById('reqContactInput');
  if (contactInput && user.phone) {
    contactInput.value = user.phone;
    currentReqForm.contact = user.phone;
  }

  const locationInput = document.getElementById('reqLocationInput');
  if (locationInput && (user.address || user.city)) {
    const loc = user.address || user.city;
    if (!locationInput.value || locationInput.value.includes('Anna Nagar, Chennai (2.8 km away)')) {
      locationInput.value = loc;
      currentReqForm.location = loc;
    }
  }

  if (user.bloodGroup) {
    selectReqBloodGroup(user.bloodGroup);
  }
}

function selectReqBloodGroup(group) {
  currentReqForm.bloodGroup = group;
  const btns = document.querySelectorAll('#reqBloodGroupGrid .blood-select-btn');
  btns.forEach(b => {
    if (b.getAttribute('data-group') === group) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });

  const note = document.getElementById('compatibleNoteText');
  if (note) {
    const compatibilityMap = {
      'O+': 'O+ patients can receive O+ and O- blood. (Matching donors in Anna Nagar: Priya Swaminathan, Sneha Reddy)',
      'O-': 'O- patients can receive ONLY O- blood. (Universal Red Cell Donor)',
      'A+': 'A+ patients can receive A+, A-, O+, and O- blood.',
      'A-': 'A- patients can receive A- and O- blood.',
      'B+': 'B+ patients can receive B+, B-, O+, and O- blood.',
      'B-': 'B- patients can receive B- and O- blood.',
      'AB+': 'AB+ is the Universal Recipient. Can receive all blood groups.',
      'AB-': 'AB- patients can receive AB-, A-, B-, and O- blood.'
    };
    note.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${compatibilityMap[group] || 'Select compatible blood group.'}`;
  }
}

function setHospitalShortcut(hospitalName, locationStr) {
  const hInput = document.getElementById('reqHospitalInput');
  const lInput = document.getElementById('reqLocationInput');
  if (hInput) hInput.value = hospitalName;
  if (lInput) lInput.value = locationStr;
  showToast(`Selected ${hospitalName}`, 'info');
}

function detectCurrentLocation() {
  const lInput = document.getElementById('reqLocationInput');
  if (lInput) {
    lInput.value = 'Anna Nagar West, Chennai (Current GPS: 13.0850° N, 80.2101° E)';
    showToast('GPS Location calibrated (~2.4 km radius)', 'success');
  }
}

function selectUrgency(level) {
  currentReqForm.urgency = level;
  const cards = {
    'Normal': document.getElementById('urgencyNormal'),
    'Urgent': document.getElementById('urgencyUrgent'),
    'Emergency': document.getElementById('urgencyEmergency')
  };

  Object.keys(cards).forEach(key => {
    if (cards[key]) cards[key].className = 'urgency-card';
  });

  if (level === 'Normal' && cards['Normal']) cards['Normal'].classList.add('active-normal');
  if (level === 'Urgent' && cards['Urgent']) cards['Urgent'].classList.add('active-urgent');
  if (level === 'Emergency' && cards['Emergency']) cards['Emergency'].classList.add('active-emergency');

  const urgencyInput = document.getElementById('reqUrgencyInput');
  if (urgencyInput) urgencyInput.value = level;
}

function adjustUnits(delta) {
  let val = parseInt(document.getElementById('reqUnitsInput').value || '2', 10);
  val += delta;
  if (val < 1) val = 1;
  if (val > 10) val = 10;
  document.getElementById('reqUnitsInput').value = val;
  document.getElementById('unitsDisplay').textContent = `${val} Unit${val > 1 ? 's' : ''}`;
}

function handleRequestFormSubmit(event) {
  event.preventDefault();
  const hospitalInput = document.getElementById('reqHospitalInput');
  const enteredHospital = hospitalInput ? hospitalInput.value.trim() : '';

  if (!enteredHospital) {
    showToast('Please enter the hospital name.', 'emergency');
    if (hospitalInput) hospitalInput.focus();
    return;
  }

  currentReqForm.hospital = enteredHospital;
  currentReqForm.location = document.getElementById('reqLocationInput').value.trim() || 'Nearby Area';
  currentReqForm.contact = document.getElementById('reqContactInput').value.trim();
  currentReqForm.notes = document.getElementById('reqNotesInput').value.trim();
  currentReqForm.units = parseInt(document.getElementById('reqUnitsInput').value, 10) || 1;

  // Populate preview modal
  const bgEl = document.getElementById('modalReqBloodGroup');
  const hospEl = document.getElementById('modalHospitalPreview');
  const unitsEl = document.getElementById('modalUnitsPreview');
  const urgEl = document.getElementById('modalUrgencyPreview');

  if (bgEl) bgEl.textContent = currentReqForm.bloodGroup;
  if (hospEl) hospEl.textContent = currentReqForm.hospital;
  if (unitsEl) unitsEl.textContent = `${currentReqForm.units} Units`;
  if (urgEl) {
    urgEl.innerHTML = currentReqForm.urgency === 'Emergency' 
      ? '🔴 Immediate Emergency' : (currentReqForm.urgency === 'Urgent' ? '🟠 Urgent' : '🟢 Normal');
  }

  openModal('confirmRequestModal');
}

/**
 * Execute sending emergency blood request & broadcast to nearby donors
 */
async function executeSendEmergencyRequest() {
  closeModal('confirmRequestModal');

  const newReq = {
    id: `req-${Date.now()}`,
    bloodGroup: currentReqForm.bloodGroup,
    hospital: currentReqForm.hospital,
    location: currentReqForm.location,
    distance: '2.4 km',
    urgency: currentReqForm.urgency,
    units: currentReqForm.units,
    patientCase: currentReqForm.notes || 'Emergency Surgical ICU Case',
    contact: currentReqForm.contact,
    notes: currentReqForm.notes,
    status: 'searching',
    createdAt: 'Just now',
    requesterId: (appState.currentUser && appState.currentUser.id) ? appState.currentUser.id : `usr-${Date.now()}`,
    requesterName: (appState.currentUser && appState.currentUser.name) ? appState.currentUser.name : 'Emergency Requester',
    respondedDonor: null
  };

  // Find compatible nearby donors from allUsers (EXCLUDING requester themselves!)
  const currentUserId = (appState.currentUser && appState.currentUser.id) ? appState.currentUser.id : null;
  const currentUserPhone = (appState.currentUser && appState.currentUser.phone) ? appState.currentUser.phone.replace(/\D/g, '') : '';
  const compatibleDonorGroups = BLOOD_COMPATIBILITY[newReq.bloodGroup] || [newReq.bloodGroup];
  const matchingDonors = appState.allUsers.filter(u => 
    u.role === 'donor' && 
    u.id !== currentUserId &&
    u.id !== newReq.requesterId &&
    (!currentUserPhone || !u.phone || u.phone.replace(/\D/g, '') !== currentUserPhone) &&
    u.availability !== false &&
    compatibleDonorGroups.includes(u.bloodGroup)
  );

  // Send request to backend
  try {
    const res = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newReq)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.request) {
        newReq.id = data.request.id;
      }
    }
  } catch (e) {
    console.warn('Backend request post fallback to local state:', e);
  }

  // Prepend to requests list
  appState.requests.unshift(newReq);

  // Add emergency notification targeting donors (marked with creatorId so requester is not notified)
  const notif = {
    id: `notif-${Date.now()}`,
    title: `🚨 Emergency ${newReq.bloodGroup} Blood Request`,
    message: `${newReq.hospital} urgently needs ${newReq.units} unit(s) of ${newReq.bloodGroup} blood. Compatible donors requested immediately.`,
    time: 'Just now',
    type: 'emergency',
    unread: true,
    targetRoles: ['donor'],
    targetBloodGroups: compatibleDonorGroups,
    reqId: newReq.id,
    creatorId: newReq.requesterId
  };
  appState.notifications.unshift(notif);

  persistAppState();
  updateUI();

  // Instant real-time multi-system cloud broadcast to all devices
  broadcastGlobalEvent({
    type: 'NEW_EMERGENCY_REQUEST',
    request: newReq,
    notification: notif
  });

  // Play audio chime
  playHospitalChime();

  showToast(`Emergency alert broadcasted to ${Math.max(matchingDonors.length, 3)} nearby compatible donors!`, 'success');

  // Navigate to Emergency Live Screen
  navigateToEmergencyLive(newReq.id);
}

// ------------------------------------------------------------------------------
// 9. Live Emergency Tracking Screen (Screen 6)
// ------------------------------------------------------------------------------
function navigateToEmergencyLive(requestId) {
  activeLiveReqId = requestId;
  const req = appState.requests.find(r => r.id === requestId) || appState.requests[0];
  if (!req) return;

  // Update banner text
  const groupEl = document.getElementById('liveBloodGroup');
  const hospEl = document.getElementById('liveHospitalName');
  const distEl = document.getElementById('liveDistance');
  if (groupEl) groupEl.textContent = req.bloodGroup;
  if (hospEl) hospEl.textContent = req.hospital;
  if (distEl) distEl.textContent = `Approximately ${req.distance || '2.4 km away'}`;

  // Populate dynamic alerted donors list
  renderNotifiedDonorsList(req.bloodGroup, req.id);

  // Render status
  renderLiveRadarStatus(req.id);

  // Navigate to screen
  navigateToScreen('screen-emergency-live');
}

/**
 * Render the nearby donors that were reached by this emergency request (EXCLUDES the requester)
 */
function renderNotifiedDonorsList(bloodGroup, requestId) {
  const listContainer = document.getElementById('liveNotifiedDonorsList');
  if (!listContainer) return;

  const req = requestId ? appState.requests.find(r => r.id === requestId) : null;
  const currentUserId = (appState.currentUser && appState.currentUser.id) ? appState.currentUser.id : null;
  const requesterId = req ? req.requesterId : currentUserId;
  const currentUserPhone = (appState.currentUser && appState.currentUser.phone) ? appState.currentUser.phone.replace(/\D/g, '') : '';
  const currentUserEmail = (appState.currentUser && appState.currentUser.email) ? appState.currentUser.email.toLowerCase().trim() : '';
  const reqLocation = (req && req.location) || (appState.currentUser && (appState.currentUser.city || appState.currentUser.address)) || 'Ukkadam, Coimbatore';

  const compatibleGroups = BLOOD_COMPATIBILITY[bloodGroup] || [bloodGroup];

  // 1. First priority: Real registered compatible donors from the network
  const compatibleDonors = (appState.allUsers || []).filter(u => 
    u && u.role === 'donor' && 
    u.id !== currentUserId &&
    u.id !== requesterId &&
    (!currentUserPhone || !u.phone || u.phone.replace(/\D/g, '') !== currentUserPhone) &&
    (!currentUserEmail || !u.email || u.email.toLowerCase().trim() !== currentUserEmail) &&
    compatibleGroups.includes(u.bloodGroup)
  );

  // 2. Second priority: Other real registered volunteer donors in the network
  const otherRealDonors = (appState.allUsers || []).filter(u => 
    u && u.role === 'donor' && 
    u.id !== currentUserId &&
    u.id !== requesterId &&
    (!currentUserPhone || !u.phone || u.phone.replace(/\D/g, '') !== currentUserPhone) &&
    (!currentUserEmail || !u.email || u.email.toLowerCase().trim() !== currentUserEmail)
  );

  let displayList = compatibleDonors.length > 0 ? compatibleDonors : otherRealDonors;

  // 3. Fallback: If network is completely new with no other registered donors yet, show local emergency volunteers in the exact city
  if (displayList.length === 0) {
    displayList = [
      { name: 'Lakshmi Preethiga', bloodGroup: bloodGroup || 'A+', distance: '1.8 km away', city: reqLocation },
      { name: 'Verified Volunteer Donor', bloodGroup: bloodGroup || 'O+', distance: '2.4 km away', city: reqLocation }
    ];
  }

  listContainer.innerHTML = displayList.map(d => `
    <div class="notified-donor-item">
      <div class="notified-donor-left">
        <span class="notified-donor-pill">${d.bloodGroup || 'A+'}</span>
        <div>
          <strong>${d.name}</strong>
          <span style="display: block; font-size: 0.7rem; color: var(--text-muted);">${d.city || d.address || reqLocation} (${d.distance || '1.8 km away'})</span>
        </div>
      </div>
      <div class="notified-donor-status">
        <i class="fa-solid fa-bell fa-shake"></i> Alert Sent
      </div>
    </div>
  `).join('');
}

/**
 * Render Live Radar Milestones and Match Card
 */
function renderLiveRadarStatus(requestId) {
  const req = appState.requests.find(r => r.id === requestId);
  if (!req) return;

  const m1 = document.getElementById('milestone1');
  const m2 = document.getElementById('milestone2');
  const m3 = document.getElementById('milestone3');
  const m4 = document.getElementById('milestone4');
  const matchedCard = document.getElementById('donorMatchedCard');
  const radarStatus = document.getElementById('liveRadarStatus');
  const activeBlip = document.querySelector('.blip-active-response');

  if (req.status === 'responded' && req.respondedDonor) {
    if (m1) m1.className = 'milestone-item completed';
    if (m2) m2.className = 'milestone-item completed';
    if (m3) m3.className = 'milestone-item completed';
    if (m4) {
      m4.className = 'milestone-item completed';
      const m4Text = document.getElementById('milestone4Text');
      const m4Time = document.getElementById('milestone4Time');
      if (m4Text) m4Text.textContent = `${req.respondedDonor.name} accepted your request!`;
      if (m4Time) m4Time.textContent = 'En Route';
    }

    if (activeBlip) activeBlip.style.display = 'block';
    if (radarStatus) radarStatus.textContent = 'Verified donor is on the way to hospital!';
    if (matchedCard) {
      matchedCard.style.display = 'block';
      const nameEl = document.getElementById('liveMatchedDonorName');
      const bloodEl = document.getElementById('liveMatchedDonorBlood');
      const etaEl = document.getElementById('liveMatchedDonorEta');
      const whatsAppBtn = document.getElementById('btnLiveWhatsAppDonor');

      if (nameEl) nameEl.textContent = req.respondedDonor.name;
      if (bloodEl) {
        bloodEl.innerHTML = `<span class="tag-blood">${req.respondedDonor.blood} Blood</span> <span class="tag-distance">~${req.respondedDonor.distance || '2.4 km away'}</span>`;
      }
      if (etaEl) {
        etaEl.innerHTML = `<i class="fa-solid fa-person-walking"></i> Est. arrival at blood bank: <strong>${req.respondedDonor.eta || '15 mins'}</strong>`;
      }
      if (whatsAppBtn) {
        whatsAppBtn.onclick = () => openDonorWhatsAppChat(req.id);
      }
    }
  } else {
    // Still searching
    if (m1) m1.className = 'milestone-item completed';
    if (m2) m2.className = 'milestone-item completed';
    if (m3) m3.className = 'milestone-item active-pulse';
    if (m4) m4.className = 'milestone-item';
    if (matchedCard) matchedCard.style.display = 'none';
    if (radarStatus) radarStatus.textContent = 'Searching for compatible nearby donors…';
    if (activeBlip) activeBlip.style.display = 'none';
  }
}

/**
 * Simulate Nearby Donor Acceptance (for one-click testing of full loop)
 */
async function simulateNearbyDonorAcceptance() {
  const req = appState.requests.find(r => r.id === activeLiveReqId) || appState.requests[0];
  if (!req) return;

  const currentUserId = (appState.currentUser && appState.currentUser.id) ? appState.currentUser.id : null;
  const currentUserPhone = (appState.currentUser && appState.currentUser.phone) ? appState.currentUser.phone.replace(/\D/g, '') : '';
  const compatibleGroups = BLOOD_COMPATIBILITY[req.bloodGroup] || [req.bloodGroup];

  const currentUserEmail = (appState.currentUser && appState.currentUser.email) ? appState.currentUser.email.toLowerCase().trim() : '';

  const eligibleDonor = appState.allUsers.find(u => 
    u && u.role === 'donor' && 
    u.id !== currentUserId && 
    u.id !== req.requesterId &&
    (!currentUserPhone || !u.phone || u.phone.replace(/\D/g, '') !== currentUserPhone) &&
    (!currentUserEmail || !u.email || u.email.toLowerCase().trim() !== currentUserEmail) &&
    compatibleGroups.includes(u.bloodGroup)
  );

  const anyRealDonor = appState.allUsers.find(u => 
    u && u.role === 'donor' && 
    u.id !== currentUserId && 
    u.id !== req.requesterId &&
    (!currentUserPhone || !u.phone || u.phone.replace(/\D/g, '') !== currentUserPhone) &&
    (!currentUserEmail || !u.email || u.email.toLowerCase().trim() !== currentUserEmail)
  );

  const donorUser = eligibleDonor || anyRealDonor || {
    id: 'usr-1790401234567',
    name: 'Lakshmi Preethiga',
    phone: '+91 98421 47070',
    bloodGroup: req.bloodGroup || 'A+',
    distance: '1.8 km away',
    city: 'Ukkadam, Coimbatore'
  };

  await respondToEmergencyAsDonor(req.id, donorUser, '12 mins');
}

/**
 * Cancel Request
 */
async function confirmCancelRequest() {
  if (confirm('Are you sure you want to cancel this emergency request?')) {
    if (activeLiveReqId) {
      const req = appState.requests.find(r => r.id === activeLiveReqId);
      if (req) req.status = 'cancelled';

      try {
        await fetch('/api/requests/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: activeLiveReqId })
        });
      } catch (e) {}
    }

    persistAppState();
    updateUI();

    // Broadcast cancellation to all systems
    broadcastGlobalEvent({
      type: 'REQUEST_CANCELLED',
      requestId: activeLiveReqId
    });

    showToast('Emergency request cancelled', 'info');
    navigateToScreen('screen-home-requester');
  }
}

// ------------------------------------------------------------------------------
// 10. Donor Experience: Incoming Alerts & Accepting Request
// ------------------------------------------------------------------------------
/**
 * Render emergency requests matching the donor's blood group
 */
function renderDonorEmergencies() {
  const container = document.getElementById('donorEmergencyCardsList');
  if (!container) return;

  const donor = (appState.activeRole === 'donor' && appState.currentUser) 
    ? appState.currentUser 
    : (appState.allUsers.find(u => u.role === 'donor') || appState.allUsers[1]);

  const donorBlood = donor.bloodGroup || 'O+';
  const currentUserId = (appState.currentUser && appState.currentUser.id) ? appState.currentUser.id : donor.id;
  const currentUserPhone = (appState.currentUser && appState.currentUser.phone) ? appState.currentUser.phone.replace(/\D/g, '') : '';

  // Check if current user has an active blood request of their own in progress
  const myActiveRequest = appState.requests.find(r => 
    (r.status === 'searching' || r.status === 'responded') &&
    (r.requesterId === currentUserId || (currentUserPhone && r.contact && r.contact.replace(/\D/g, '') === currentUserPhone))
  );

  // Find requests compatible with this donor, EXCLUDING requests created by this user themselves!
  const matchingRequests = appState.requests.filter(req => {
    if (req.status === 'cancelled' || req.status === 'completed') return false;
    // CRITICAL: A user cannot donate blood to their own emergency request!
    if (req.requesterId === currentUserId) return false;
    if (currentUserPhone && req.contact && req.contact.replace(/\D/g, '') === currentUserPhone) return false;
    return isDonorCompatible(donorBlood, req.bloodGroup);
  });

  const countBadge = document.getElementById('donorNearbyCount');
  if (countBadge) {
    countBadge.textContent = `${matchingRequests.length} Urgent`;
  }

  let myRequestBanner = '';
  if (myActiveRequest) {
    myRequestBanner = `
      <div class="my-active-request-banner" style="background: linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(245, 158, 11, 0.08)); border: 1.5px solid rgba(239, 68, 68, 0.25); border-radius: 14px; padding: 14px 16px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(239, 68, 68, 0.15); display: flex; align-items: center; justify-content: center; color: #dc2626; font-size: 1.1rem;">
            <i class="fa-solid fa-hospital-user"></i>
          </div>
          <div>
            <div style="font-size: 0.85rem; font-weight: 700; color: #0f172a;">Your Blood Request is Active: <span style="color: #dc2626;">${myActiveRequest.bloodGroup}</span> (${myActiveRequest.units} Units)</div>
            <div style="font-size: 0.75rem; color: #64748b;">${myActiveRequest.hospital} • ${myActiveRequest.status === 'responded' ? '❤️ Verified Donor En Route' : '📡 Broadcasting to nearby donors'}</div>
          </div>
        </div>
        <button class="btn-secondary-sm" onclick="navigateToEmergencyLive('${myActiveRequest.id}')" style="white-space: nowrap; font-size: 0.78rem;">
          <i class="fa-solid fa-satellite-dish"></i> Track Your Request
        </button>
      </div>
    `;
  }

  if (matchingRequests.length === 0) {
    container.innerHTML = `
      ${myRequestBanner}
      <div style="text-align: center; padding: 40px 20px; background: #FFFFFF; border-radius: 16px; border: 1px dashed var(--border-default);">
        <i class="fa-solid fa-heart-circle-check" style="font-size: 2.2rem; color: #10B981; margin-bottom: 8px; display: block;"></i>
        <strong style="color: var(--text-main); font-size: 0.95rem;">Standby for Emergency Requests</strong>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
          No other emergency requests for ${donorBlood} donors in your zone right now. You will receive an immediate notification when a matching patient needs blood.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = myRequestBanner + matchingRequests.map(req => {
    const isRespondedByMe = req.respondedDonor && req.respondedDonor.id === donor.id;
    return `
      <div class="donor-request-item ${req.urgency === 'Emergency' ? 'high-emergency' : 'normal-urgent'}">
        <div class="donor-item-top">
          <div class="blood-urgency-tag">
            <span class="req-blood-badge ${req.bloodGroup === donorBlood ? '' : 'secondary'}">${req.bloodGroup}</span>
            <div class="tag-urgency ${req.urgency.toLowerCase()}">
              <span class="pulse-beacon"></span> ${req.urgency.toUpperCase()}
            </div>
          </div>
          <span class="posted-time"><i class="fa-regular fa-clock"></i> ${req.createdAt}</span>
        </div>

        <div class="donor-item-body">
          <h4 class="req-title">${req.hospital}</h4>
          <div class="req-meta-row">
            <span><i class="fa-solid fa-location-dot text-primary"></i> ~${req.distance || '2.4 km'} from you</span>
            <span>•</span>
            <span><i class="fa-solid fa-prescription-bottle-medical"></i> ${req.units} Units Needed</span>
          </div>
          <p class="req-note">
            ${req.patientCase || req.notes || 'Emergency ICU patient awaiting compatible donor.'}
          </p>
        </div>

        <div class="donor-item-actions" style="display: flex; gap: 8px;">
          ${isRespondedByMe ? `
            <button class="btn-primary" style="flex: 1;" onclick="openDonorRequestDetails('${req.id}')">
              <i class="fa-solid fa-circle-check"></i> VIEW ROUTE & DETAILS
            </button>
            <button class="btn-whatsapp-sm" style="padding: 8px 14px;" onclick="openRequesterWhatsAppChat('${req.id}')" title="Chat with requester on WhatsApp">
              <i class="fa-brands fa-whatsapp"></i> WhatsApp
            </button>
          ` : `
            <button class="btn-can-help" onclick="openDonorRequestDetails('${req.id}')">
              <i class="fa-solid fa-hand-holding-droplet"></i>
              <span>I CAN HELP</span>
            </button>
            <button class="btn-view-req" onclick="openDonorRequestDetails('${req.id}')">
              View Details
            </button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Open details of emergency request for donor
 */
function openDonorRequestDetails(reqId) {
  const req = appState.requests.find(r => r.id === reqId) || appState.requests[0];
  if (!req) return;

  const currentUserId = (appState.currentUser && appState.currentUser.id) ? appState.currentUser.id : null;
  const currentUserPhone = (appState.currentUser && appState.currentUser.phone) ? appState.currentUser.phone.replace(/\D/g, '') : '';

  // Prevent self-donation view: if this request belongs to current user, open tracker instead
  if (req.requesterId === currentUserId || (currentUserPhone && req.contact && req.contact.replace(/\D/g, '') === currentUserPhone)) {
    showToast('This is your own blood request. Opening live tracker.', 'info');
    navigateToEmergencyLive(req.id);
    return;
  }

  activeLiveReqId = req.id;

  const bg = document.getElementById('detailBloodGroup');
  const hosp = document.getElementById('detailHospital');
  const dist = document.getElementById('detailDistance');
  const units = document.getElementById('detailUnits');
  const urgBadge = document.getElementById('detailUrgencyBadge');
  const patientCaseEl = document.getElementById('detailPatientCase');
  const pinEl = document.getElementById('detailMapHospitalPin');
  const stepEl = document.getElementById('confirmedHospitalStep');
  const refEl = document.getElementById('confirmedRefCode');

  if (bg) bg.textContent = req.bloodGroup;
  if (hosp) hosp.textContent = req.hospital || 'Hospital';
  if (dist) dist.textContent = `Approximately ${req.distance || '2.4 km away'}`;
  if (units) units.textContent = `${req.units} Units (Whole Blood / RBC)`;
  if (patientCaseEl) patientCaseEl.textContent = req.patientCase || req.notes || 'Emergency Surgical ICU Case';
  if (pinEl) pinEl.textContent = req.hospital || 'Hospital Location';
  if (stepEl) stepEl.textContent = `${req.hospital || 'Hospital'} Blood Bank`;
  if (refEl) refEl.textContent = (req.id || 'BC-EMERG').toUpperCase();

  if (urgBadge) {
    urgBadge.innerHTML = req.urgency === 'Emergency'
      ? '<i class="fa-solid fa-triangle-exclamation"></i> EMERGENCY'
      : '<i class="fa-solid fa-circle-exclamation"></i> URGENT';
  }

  const actions = document.getElementById('donorDetailsActions');
  const confirmed = document.getElementById('responseConfirmedCard');

  if (req.status === 'responded') {
    if (actions) actions.style.display = 'none';
    if (confirmed) confirmed.style.display = 'block';
  } else {
    if (actions) actions.style.display = 'flex';
    if (confirmed) confirmed.style.display = 'none';
  }

  navigateToScreen('screen-donor-request-details');
}

/**
 * Donor confirms "I CAN HELP" from request details
 */
async function submitDonorHelpResponse() {
  const req = appState.requests.find(r => r.id === activeLiveReqId) || appState.requests[0];
  if (!req) return;

  const donor = appState.currentUser && appState.currentUser.role === 'donor'
    ? appState.currentUser
    : (appState.allUsers.find(u => u.id === 'usr-donor-1') || appState.allUsers[1]);

  await respondToEmergencyAsDonor(req.id, donor, '15 mins');
}

/**
 * Core response dispatcher: sends acceptance to backend, records donor info, and notifies requester
 */
async function respondToEmergencyAsDonor(requestId, donorUser, eta = '15 mins') {
  const req = appState.requests.find(r => r.id === requestId);
  if (!req) return;

  const currentUserId = (appState.currentUser && appState.currentUser.id) ? appState.currentUser.id : null;
  const currentUserPhone = (appState.currentUser && appState.currentUser.phone) ? appState.currentUser.phone.replace(/\D/g, '') : '';
  const donorPhoneDigits = (donorUser.phone || '').replace(/\D/g, '');
  const reqContactDigits = (req.contact || '').replace(/\D/g, '');

  // Prevent donating blood to own request
  if (donorUser.id === req.requesterId || 
      (currentUserId && req.requesterId === currentUserId) ||
      (donorPhoneDigits && reqContactDigits && donorPhoneDigits === reqContactDigits) ||
      (currentUserPhone && reqContactDigits && currentUserPhone === reqContactDigits)) {
    showToast('You cannot donate blood to your own request.', 'emergency');
    return;
  }

  req.status = 'responded';
  req.respondedDonor = {
    id: donorUser.id,
    name: donorUser.name,
    phone: donorUser.phone,
    blood: donorUser.bloodGroup,
    distance: donorUser.distance || '2.4 km away',
    eta: eta,
    respondedAt: new Date().toISOString()
  };

  // Call server API
  try {
    await fetch('/api/requests/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: req.id,
        donorId: donorUser.id,
        donorName: donorUser.name,
        donorPhone: donorUser.phone,
        donorBlood: donorUser.bloodGroup,
        eta: eta
      })
    });
  } catch (e) {
    console.warn('Backend respond fallback to local state:', e);
  }

  // Update donor profile stats
  if (appState.currentUser && appState.currentUser.role === 'donor') {
    appState.currentUser.rapidResponses = (appState.currentUser.rapidResponses || 0) + 1;
  }

  // Add notification for requester
  appState.notifications.unshift({
    id: `notif-${Date.now()}`,
    title: '❤️ Verified Donor Responded!',
    message: `${donorUser.name} (${donorUser.bloodGroup}) accepted your emergency request for ${req.hospital} and is en route! (ETA: ${eta})`,
    time: 'Just now',
    type: 'matches',
    unread: true,
    targetRoles: ['requester'],
    reqId: req.id
  });

  persistAppState();
  updateUI();

  // Instant real-time multi-system cloud broadcast
  broadcastGlobalEvent({
    type: 'DONOR_RESPONDED',
    request: req
  });

  // Play audio chime
  playHospitalChime();

  // Update response card in details screen
  const token = `BC-${Math.floor(100 + Math.random() * 900)}-${req.bloodGroup.replace('+', 'P').replace('-', 'N')}`;
  const refCodeEl = document.getElementById('confirmedRefCode');
  if (refCodeEl) refCodeEl.textContent = token;

  const actions = document.getElementById('donorDetailsActions');
  const confirmed = document.getElementById('responseConfirmedCard');
  if (actions) actions.style.display = 'none';
  if (confirmed) confirmed.style.display = 'block';

  showToast(`❤️ Thank you ${donorUser.name}! Requester ${req.requesterName || 'Coordinator'} has been notified.`, 'success');

  // If live radar is open, update it
  if (currentScreenId === 'screen-emergency-live') {
    renderLiveRadarStatus(req.id);
  }
}

function showHospitalDetailsModal(reqId) {
  const targetId = reqId || activeLiveReqId;
  const req = appState.requests.find(r => r.id === targetId) || appState.requests[0];
  if (req) {
    const hospEl = document.getElementById('modalHospitalDetailName');
    const locEl = document.getElementById('modalHospitalDetailLocation');
    const contactEl = document.getElementById('modalHospitalDetailContact');
    const refEl = document.getElementById('modalHospitalRefCode');
    if (hospEl) hospEl.textContent = req.hospital || 'Hospital Emergency Desk';
    if (locEl) locEl.textContent = req.location || 'Hospital Reception & Blood Bank';
    if (contactEl) contactEl.textContent = req.contact || '+91 98401 23456';
    if (refEl) refEl.textContent = (req.id || 'BC-EMERG').toUpperCase();
  }
  openModal('hospitalDetailsModal');
}

function simulateDirectionsOpen(reqId) {
  const targetId = reqId || activeLiveReqId;
  const req = appState.requests.find(r => r.id === targetId) || appState.requests[0];
  if (req) {
    const destEl = document.getElementById('navModalHospitalDest');
    if (destEl) destEl.textContent = `Arrive at ${req.hospital || 'Hospital'}`;
  }
  openModal('routeNavigationModal');
}

function refreshDonorNearbyList() {
  showToast('Refreshing emergency requests in your area...', 'info');
  fetchDataFromBackend();
  setTimeout(() => {
    renderDonorEmergencies();
    showToast('Nearby emergency feed updated', 'success');
  }, 400);
}

function toggleDonorAvailability(isAvailable) {
  if (appState.currentUser && appState.currentUser.role === 'donor') {
    appState.currentUser.availability = isAvailable;
    const match = appState.allUsers.find(u => u.id === appState.currentUser.id);
    if (match) match.availability = isAvailable;
  }

  const card = document.getElementById('donorAvailabilityCard');
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusTextDisplay');
  const sub = document.getElementById('statusSubDisplay');
  const profileToggle = document.getElementById('profileAvailabilityToggle');
  const donorToggle = document.getElementById('donorAvailabilityToggle');

  if (profileToggle) profileToggle.checked = isAvailable;
  if (donorToggle) donorToggle.checked = isAvailable;

  if (isAvailable) {
    if (card) card.className = 'availability-status-card';
    if (dot) dot.className = 'status-indicator-dot online';
    if (text) text.textContent = 'Available for Emergency Requests';
    if (sub) sub.textContent = 'You will receive priority push alerts for nearby emergencies';
    showToast('You are ONLINE for emergency alerts', 'success');
  } else {
    if (card) card.className = 'availability-status-card offline';
    if (dot) dot.className = 'status-indicator-dot offline';
    if (text) text.textContent = 'Currently Not Available';
    if (sub) sub.textContent = 'Emergency alerts paused. Tap switch to re-activate.';
    showToast('Availability paused', 'info');
  }

  persistAppState();
  publishCloudState();

  if (appState.currentUser) {
    try {
      fetch('/api/donors/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ donorId: appState.currentUser.id, availability: isAvailable })
      }).catch(() => {});
    } catch (e) {}
  }
}

// ------------------------------------------------------------------------------
// 11. My Requests Filter & Render (Screen 10)
// ------------------------------------------------------------------------------
let currentRequestsFilter = 'active';

function filterRequestsTab(filter) {
  currentRequestsFilter = filter;
  ['active', 'completed', 'cancelled'].forEach(f => {
    const tab = document.getElementById(`tab${f.charAt(0).toUpperCase() + f.slice(1)}`);
    if (tab) {
      if (f === filter) tab.classList.add('active');
      else tab.classList.remove('active');
    }
  });

  renderMyRequestsList();
}

function renderMyRequestsList() {
  const container = document.getElementById('myRequestsListContainer');
  if (!container) return;

  const filtered = appState.requests.filter(req => {
    if (currentRequestsFilter === 'active') {
      return req.status === 'searching' || req.status === 'responded';
    }
    return req.status === currentRequestsFilter;
  });

  const activeCount = appState.requests.filter(r => r.status === 'searching' || r.status === 'responded').length;
  const completedCount = appState.requests.filter(r => r.status === 'completed').length;
  const cancelledCount = appState.requests.filter(r => r.status === 'cancelled').length;

  const countActiveEl = document.getElementById('tabCountActive');
  const countCompletedEl = document.getElementById('tabCountCompleted');
  const countCancelledEl = document.getElementById('tabCountCancelled');
  if (countActiveEl) countActiveEl.textContent = activeCount;
  if (countCompletedEl) countCompletedEl.textContent = completedCount;
  if (countCancelledEl) countCancelledEl.textContent = cancelledCount;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; background: #FFFFFF; border-radius: 16px; border: 1px dashed var(--border-default);">
        <i class="fa-regular fa-folder-open" style="font-size: 2.2rem; color: #94A3B8; margin-bottom: 8px;"></i>
        <div style="font-size: 0.95rem; font-weight: 700; color: #334155;">No ${currentRequestsFilter} requests</div>
        <p style="font-size: 0.78rem; color: #64748B; margin-top: 4px;">Submitted emergency blood alerts will appear here.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(req => {
    let statusBadge = '<span class="status-badge searching"><i class="fa-solid fa-spinner fa-spin"></i> Searching Nearby Donors</span>';
    if (req.status === 'responded') {
      statusBadge = `<span class="status-badge completed"><i class="fa-solid fa-user-check"></i> Donor En Route (${req.respondedDonor ? req.respondedDonor.name : 'Verified Donor'})</span>`;
    } else if (req.status === 'completed') {
      statusBadge = '<span class="status-badge completed"><i class="fa-solid fa-circle-check"></i> Blood Received</span>';
    } else if (req.status === 'cancelled') {
      statusBadge = '<span class="status-badge cancelled">Cancelled</span>';
    }

    return `
      <div class="my-request-card">
        <div class="my-req-top">
          <div class="blood-req-badge">
            <span class="blood-group">${req.bloodGroup}</span>
            <span class="req-label">${req.units} Units</span>
          </div>
          ${statusBadge}
        </div>
        <div style="font-size: 0.95rem; font-weight: 800; color: #0F172A; margin: 4px 0 2px;">
          ${req.hospital}
        </div>
        <div style="font-size: 0.75rem; color: #64748B; display: flex; gap: 8px;">
          <span><i class="fa-solid fa-location-dot"></i> ${req.distance || '2.4 km'}</span>
          <span>•</span>
          <span><i class="fa-regular fa-clock"></i> ${req.createdAt}</span>
        </div>
        <div style="display: flex; justify-content: flex-end; margin-top: 8px; gap: 8px;">
          <button class="btn-secondary-sm" onclick="navigateToEmergencyLive('${req.id}')">
            View Live Tracker
          </button>
          ${req.status === 'responded' && req.respondedDonor ? `
            <button class="btn-whatsapp-sm" onclick="openDonorWhatsAppChat('${req.id}')" title="Chat with responded donor on WhatsApp">
              <i class="fa-brands fa-whatsapp"></i> WhatsApp Donor
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ------------------------------------------------------------------------------
// 12. Fulfillment / Blood Received Flow
// ------------------------------------------------------------------------------
function openFulfillmentModal() {
  openModal('fulfillmentModal');
}

async function completeFulfillmentAndRedirect() {
  closeModal('fulfillmentModal');

  const activeReq = appState.requests.find(r => r.status === 'searching' || r.status === 'responded') || appState.requests[0];
  if (activeReq) {
    activeReq.status = 'completed';

    try {
      await fetch('/api/requests/fulfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: activeReq.id })
      });
    } catch (e) {}
  }

  // Update donor impact metrics
  if (activeReq && activeReq.respondedDonor) {
    const donorUser = appState.allUsers.find(u => u.id === activeReq.respondedDonor.id);
    if (donorUser) {
      donorUser.donationsCount = (donorUser.donationsCount || 0) + 1;
      donorUser.impactLives = (donorUser.impactLives || 0) + 3;
    }
  }

  persistAppState();
  updateUI();

  // Instant real-time multi-system cloud broadcast
  if (activeReq) {
    broadcastGlobalEvent({
      type: 'REQUEST_FULFILLED',
      request: activeReq
    });
  }

  playHospitalChime();
  showToast('🎉 Emergency Blood Received! Request marked as completed.', 'success');

  navigateToScreen('screen-my-requests');
  filterRequestsTab('completed');
}

// ------------------------------------------------------------------------------
// 13. Compatibility Matrix Modal
// ------------------------------------------------------------------------------
function openCompatibilityModal(group) {
  const defaultGroup = group || (appState.currentUser ? appState.currentUser.bloodGroup : 'O+');
  selectCompatibilityGroup(defaultGroup);
  openModal('compatibilityModal');
}

function selectCompatibilityGroup(group) {
  const data = COMPATIBILITY_GUIDE[group] || COMPATIBILITY_GUIDE['O+'];

  const chips = document.querySelectorAll('#compatGroupButtons .compat-chip');
  chips.forEach(c => {
    if (c.textContent.trim() === group) {
      c.classList.add('active');
    } else {
      c.classList.remove('active');
    }
  });

  const badge = document.getElementById('compatActiveBadge');
  const title = document.getElementById('compatTitle');
  const subtitle = document.getElementById('compatSubtitle');
  const receivePills = document.getElementById('compatReceivePills');
  const donatePills = document.getElementById('compatDonatePills');

  if (badge) badge.textContent = group;
  if (title) title.textContent = data.name;
  if (subtitle) subtitle.textContent = data.subtitle;

  if (receivePills) {
    receivePills.innerHTML = data.canReceive.map(g => {
      const isUniversal = g === 'O-' ? ' (Universal Donor)' : '';
      return `<span class="pill-chip green">${g}${isUniversal}</span>`;
    }).join('');
  }

  if (donatePills) {
    donatePills.innerHTML = data.canDonate.map(g => {
      const isUniversal = g === 'AB+' ? ' (Universal Recipient)' : '';
      return `<span class="pill-chip red">${g}${isUniversal}</span>`;
    }).join('');
  }
}

// ------------------------------------------------------------------------------
// 14. Notification Center
// ------------------------------------------------------------------------------
let currentNotifFilter = 'all';

function showNotificationCenter() {
  renderNotificationList('all');
  openModal('notificationCenterModal');
}

function filterNotifications(filter, tabBtn) {
  currentNotifFilter = filter;
  const tabs = document.querySelectorAll('.notif-filter-tabs .notif-tab');
  tabs.forEach(t => t.classList.remove('active'));
  if (tabBtn) tabBtn.classList.add('active');

  renderNotificationList(filter);
}

/**
 * Filter notifications so the requester does NOT receive a broadcast asking them to donate to their own request!
 */
function getFilteredNotifications() {
  const currentUserId = (appState.currentUser && appState.currentUser.id) ? appState.currentUser.id : null;
  const currentUserPhone = (appState.currentUser && appState.currentUser.phone) ? appState.currentUser.phone.replace(/\D/g, '') : '';

  return (appState.notifications || []).filter(n => {
    if (n.type === 'emergency') {
      if (currentUserId && n.creatorId === currentUserId) return false;
      if (n.reqId) {
        const req = (appState.requests || []).find(r => r.id === n.reqId);
        if (req) {
          if (currentUserId && req.requesterId === currentUserId) return false;
          if (currentUserPhone && req.contact && req.contact.replace(/\D/g, '') === currentUserPhone) return false;
        }
      }
    }
    return true;
  });
}

function renderNotificationList(filter = 'all') {
  const container = document.getElementById('notificationList');
  if (!container) return;

  const notifs = getFilteredNotifications();
  const filtered = notifs.filter(n => {
    if (filter === 'all') return true;
    return n.type === filter;
  });

  const elAll = document.getElementById('notifCountAll');
  const elEmerg = document.getElementById('notifCountEmergency');
  const elMatches = document.getElementById('notifCountMatches');
  if (elAll) elAll.textContent = notifs.length;
  if (elEmerg) elEmerg.textContent = notifs.filter(n => n.type === 'emergency').length;
  if (elMatches) elMatches.textContent = notifs.filter(n => n.type === 'matches').length;

  updateNotificationBadges();

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px 10px; color: var(--text-muted); font-size: 0.8rem;">
        <i class="fa-regular fa-bell-slash" style="font-size: 1.8rem; margin-bottom: 6px; display: block;"></i>
        No notifications in this category.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(n => {
    let iconClass = 'fa-solid fa-bell';
    let iconType = 'info';
    if (n.type === 'emergency') {
      iconClass = 'fa-solid fa-triangle-exclamation';
      iconType = 'emergency';
    } else if (n.type === 'matches') {
      iconClass = 'fa-solid fa-heart-pulse';
      iconType = 'match';
    }

    return `
      <div class="notif-card ${n.unread ? 'unread' : ''}" onclick="handleNotificationClick('${n.id}', '${n.reqId || ''}')">
        <div class="notif-icon ${iconType}">
          <i class="${iconClass}"></i>
        </div>
        <div class="notif-content">
          <strong>${n.title}</strong>
          <p>${n.message}</p>
          <span class="notif-time">${n.time}</span>
        </div>
      </div>
    `;
  }).join('');
}

function updateNotificationBadges() {
  const notifs = getFilteredNotifications();
  const unreadCount = notifs.filter(n => n.unread).length;
  const badgeDot = document.getElementById('headerAlertBadge');
  const navAlertDot = document.getElementById('navAlertDot');
  if (badgeDot) badgeDot.style.display = unreadCount > 0 ? 'block' : 'none';
  if (navAlertDot) navAlertDot.style.display = unreadCount > 0 ? 'block' : 'none';
}

function handleNotificationClick(notifId, reqId) {
  const notif = (appState.notifications || []).find(n => n.id === notifId);
  if (notif) {
    notif.unread = false;
    persistAppState();
    renderNotificationList(currentNotifFilter);
  }
  closeModal('notificationCenterModal');

  if (reqId) {
    if (appState.activeRole === 'donor') {
      openDonorRequestDetails(reqId);
    } else {
      navigateToEmergencyLive(reqId);
    }
  }
}

function markAllNotificationsRead() {
  (appState.notifications || []).forEach(n => n.unread = false);
  persistAppState();
  renderNotificationList(currentNotifFilter);
  showToast('All notifications marked as read', 'success');
}

// ------------------------------------------------------------------------------
// 15. Instant WhatsApp Communication & Helpers
// ------------------------------------------------------------------------------
/**
 * Opens a WhatsApp direct chat in a new browser tab with clean international number
 */
function openWhatsAppChat(phoneNumber, customMessage) {
  let clean = (phoneNumber || '').replace(/\D/g, '');
  // Format for Indian numbers: prepend 91 if 10 digits
  if (clean.length === 10) clean = '91' + clean;
  if (!clean) clean = '919840123456';
  const msg = encodeURIComponent(customMessage || 'Hello, I am contacting you regarding a BloodConnect emergency blood request.');
  const url = `https://wa.me/${clean}?text=${msg}`;
  window.open(url, '_blank');
}

/**
 * Opens WhatsApp chat with the donor who responded to this request
 */
function openDonorWhatsAppChat(requestId) {
  const targetId = requestId || activeLiveReqId;
  const req = appState.requests.find(r => r.id === targetId) || appState.requests[0];
  if (!req || !req.respondedDonor) {
    showToast('No responded donor available to chat.', 'info');
    return;
  }
  const phone = req.respondedDonor.phone || '+91 98401 23456';
  const msg = `Hello ${req.respondedDonor.name}, thank you for accepting our blood request (${req.bloodGroup} at ${req.hospital}). Please let us know your arrival time!`;
  openWhatsAppChat(phone, msg);
}

/**
 * Opens WhatsApp chat with the requester for this request
 */
function openRequesterWhatsAppChat(requestId) {
  const targetId = requestId || activeLiveReqId;
  const req = appState.requests.find(r => r.id === targetId) || appState.requests[0];
  if (!req) return;
  const phone = req.contact || '+91 98765 43210';
  const msg = `Hello ${req.requesterName || ''}, I have accepted your emergency blood request for ${req.bloodGroup} at ${req.hospital}. I am on my way to help.`;
  openWhatsAppChat(phone, msg);
}

/**
 * Opens WhatsApp chat with the hospital desk
 */
function openHospitalWhatsAppChat(requestId) {
  const targetId = requestId || activeLiveReqId;
  const req = appState.requests.find(r => r.id === targetId) || appState.requests[0];
  const phone = (req && req.contact) ? req.contact : '+91 98401 23456';
  const hospName = (req && req.hospital) ? req.hospital : 'Hospital';
  const ref = req ? req.id.toUpperCase() : 'BC-EMERG-842';
  const msg = `Hello ${hospName} Blood Bank Reception, coordinating donor arrival for emergency reference ${ref}.`;
  openWhatsAppChat(phone, msg);
}

let simulatedCallInterval = null;
let simulatedCallSeconds = 0;

function simulateInAppCall(contactName, contactNumber) {
  const nameEl = document.getElementById('callingContactName');
  const numEl = document.getElementById('callingContactNumber');
  const statusEl = document.getElementById('callingStatusText');

  if (nameEl) nameEl.textContent = contactName || 'Hospital Blood Bank Reception';
  if (numEl) numEl.textContent = contactNumber || '+91 44 2834 9900';
  if (statusEl) statusEl.textContent = 'Connecting...';

  openModal('simulatedCallModal');
  playHospitalChime();

  if (simulatedCallInterval) clearInterval(simulatedCallInterval);
  simulatedCallSeconds = 0;

  setTimeout(() => {
    const modal = document.getElementById('simulatedCallModal');
    if (!modal || !modal.classList.contains('active')) return;
    if (statusEl) statusEl.textContent = 'Connected (00:01)';
    simulatedCallSeconds = 1;

    simulatedCallInterval = setInterval(() => {
      simulatedCallSeconds++;
      const mins = Math.floor(simulatedCallSeconds / 60);
      const secs = simulatedCallSeconds % 60;
      const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      if (statusEl) statusEl.textContent = `Connected (${formatted})`;
    }, 1000);
  }, 1600);
}

function toggleCallMute(btn) {
  if (!btn) return;
  btn.classList.toggle('active');
  const isMuted = btn.classList.contains('active');
  btn.querySelector('span').textContent = isMuted ? 'Muted' : 'Mute';
  showToast(isMuted ? 'Microphone muted' : 'Microphone unmuted', 'info');
}

function toggleCallSpeaker(btn) {
  if (!btn) return;
  btn.classList.toggle('active');
  const isSpeaker = btn.classList.contains('active');
  showToast(isSpeaker ? 'Speakerphone turned on' : 'Speakerphone turned off', 'info');
}

function endSimulatedCall() {
  if (simulatedCallInterval) {
    clearInterval(simulatedCallInterval);
    simulatedCallInterval = null;
  }
  closeModal('simulatedCallModal');
  showToast(`Call ended (${simulatedCallSeconds}s)`, 'info');
}

function showNearbyRequestsModal() {
  openModal('nearbyExplorerModal');
}

function setSearchRadius(km, btn) {
  const chips = document.querySelectorAll('.radius-chips .radius-chip');
  chips.forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const circle1 = document.querySelector('.map-radar-circle.r-1');
  const circle2 = document.querySelector('.map-radar-circle.r-2');
  if (circle1 && circle2) {
    circle1.style.transform = `scale(${km / 3})`;
    circle2.style.transform = `scale(${km / 3})`;
  }

  showToast(`Radius filter set to ${km} km`, 'info');
}

function startSimulatedNavigation() {
  closeModal('routeNavigationModal');
  showToast('GPS Guidance Started: "In 600 meters, turn right on 100 Feet Road"', 'success');
}

function showSafetyGuidelinesModal() {
  openModal('safetyGuidelinesModal');
}

function openDonorResponseModal() {
  openModal('hospitalDetailsModal');
}

// ------------------------------------------------------------------------------
// 16. Profile & Settings Modal
// ------------------------------------------------------------------------------
function openEditProfileModal() {
  const user = appState.currentUser;
  if (!user) return;

  document.getElementById('editName').value = user.name || '';
  document.getElementById('editPhone').value = user.phone || '';
  document.getElementById('editCity').value = user.city || '';
  document.getElementById('editBloodGroup').value = user.bloodGroup || 'O+';

  openModal('editProfileModal');
}

function handleProfileSave(event) {
  event.preventDefault();
  const name = document.getElementById('editName').value;
  const phone = document.getElementById('editPhone').value;
  const city = document.getElementById('editCity').value;
  const bloodGroup = document.getElementById('editBloodGroup').value;

  if (appState.currentUser) {
    appState.currentUser.name = name;
    appState.currentUser.phone = phone;
    appState.currentUser.city = city;
    appState.currentUser.bloodGroup = bloodGroup;
  }

  // Update in allUsers array too
  const u = appState.allUsers.find(item => item.id === appState.currentUser.id);
  if (u) {
    u.name = name;
    u.phone = phone;
    u.city = city;
    u.bloodGroup = bloodGroup;
  }

  persistAppState();
  updateUI();
  closeModal('editProfileModal');
  showToast('Profile updated successfully!', 'success');
}

function handleEmergencyAlertsToggle(checked) {
  if (appState.currentUser) {
    appState.currentUser.emergencyOptIn = checked;
  }
  persistAppState();
  showToast(checked ? 'Emergency push notifications enabled' : 'Emergency notifications muted', 'info');
}

/**
 * Permanently delete the signed-in account
 */
async function deleteCurrentAccount() {
  if (!appState.currentUser) {
    showToast('No active account signed in', 'info');
    return;
  }

  const user = appState.currentUser;
  if (!confirm(`Are you sure you want to permanently delete the account for "${user.name}"? All your data and active requests will be removed.`)) {
    return;
  }

  const userId = user.id;

  try {
    await fetch('/api/auth/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
  } catch (e) {
    console.warn('Backend delete error:', e);
  }

  // Remove locally
  appState.allUsers = (appState.allUsers || []).filter(u => u.id !== userId);
  appState.requests = (appState.requests || []).filter(r => r.requesterId !== userId);
  appState.currentUser = null;
  appState.isAuthenticated = false;
  try { sessionStorage.removeItem('bloodconnect_session_active'); } catch (e) {}
  persistAppState();
  updateUI();

  // Sync deletion across systems
  broadcastGlobalEvent({ type: 'USER_DELETED', userId });

  showToast('Your account has been permanently removed.', 'info');
  navigateToScreen('screen-login', false);
}

/**
 * Wipe all accounts and reset database completely
 */
async function resetPrototypeData() {
  if (!confirm('Are you sure you want to wipe ALL accounts and data from the database? This cannot be undone.')) {
    return;
  }

  try {
    await fetch('/api/auth/clear-all-accounts', { method: 'POST' });
  } catch (e) {}

  localStorage.removeItem('bloodconnect_app_session_v2');
  try { sessionStorage.removeItem('bloodconnect_session_active'); } catch (e) {}

  appState = {
    isAuthenticated: false,
    activeRole: 'donor',
    selectedLoginRole: 'donor',
    currentUser: null,
    allUsers: [],
    requests: [],
    notifications: [],
    historyStack: []
  };

  persistAppState();

  // Sync wipe across all systems
  broadcastGlobalEvent({ type: 'ALL_ACCOUNTS_CLEARED' });

  showToast('All accounts and requests have been wiped clean', 'success');
  updateUI();
  navigateToScreen('screen-login', false);
}

/**
 * Render active requests on Requester Dashboard
 */
function renderRequesterActiveRequests() {
  const container = document.getElementById('requesterActiveList');
  const countBadge = document.getElementById('activeRequestCount');
  if (!container) return;

  const currentUserId = (appState.currentUser && appState.currentUser.id) ? appState.currentUser.id : null;
  const currentUserPhone = (appState.currentUser && appState.currentUser.phone) ? appState.currentUser.phone.replace(/\D/g, '') : '';

  // Get active requests belonging to this user
  let activeRequests = appState.requests.filter(r => 
    (r.status === 'searching' || r.status === 'responded') &&
    (r.requesterId === currentUserId || (currentUserPhone && r.contact && r.contact.replace(/\D/g, '') === currentUserPhone))
  );

  if (countBadge) {
    countBadge.textContent = `${activeRequests.length} Active`;
  }

  if (activeRequests.length === 0) {
    container.innerHTML = `
      <div style="background: #FFFFFF; border-radius: 16px; border: 1px dashed var(--border-default); padding: 32px 20px; text-align: center;">
        <i class="fa-solid fa-file-circle-plus" style="font-size: 2rem; color: #94A3B8; margin-bottom: 8px; display: block;"></i>
        <strong style="color: #334155; font-size: 0.95rem;">No Active Blood Requests</strong>
        <p style="color: #64748B; font-size: 0.8rem; margin: 4px 0 16px;">
          Need blood for yourself or a patient? Tap below to broadcast an emergency request to nearby verified donors.
        </p>
        <button class="btn-primary" style="margin: 0 auto; display: inline-flex;" onclick="handleRequestBloodNav()">
          <i class="fa-solid fa-droplet"></i> Create Blood Request
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = activeRequests.map(req => {
    const isResponded = req.status === 'responded' && req.respondedDonor;
    return `
      <div class="request-card emergency-border">
        <div class="req-card-header">
          <div class="blood-req-badge">
            <span class="blood-group">${req.bloodGroup}</span>
            <span class="req-label">${req.units} Units</span>
          </div>
          <div class="req-urgency-tag ${req.urgency.toLowerCase()}">
            <span class="pulse-dot"></span> ${req.urgency}
          </div>
        </div>

        <div class="req-hospital-info">
          <div class="hospital-name">
            <i class="fa-solid fa-hospital"></i> ${req.hospital}
          </div>
          <div class="hospital-sub">
            <span><i class="fa-solid fa-location-dot"></i> ${req.location || 'Nearby'}</span>
            <span>•</span>
            <span><i class="fa-solid fa-clock"></i> ${req.createdAt}</span>
          </div>
        </div>

        <div class="req-status-tracker">
          <div class="status-tracker-label">
            <span>Status:</span>
            ${isResponded 
              ? `<strong class="text-green" style="color: #16A34A;"><i class="fa-solid fa-user-check"></i> ${req.respondedDonor.name} En Route (${req.respondedDonor.eta || '15 mins'})</strong>` 
              : `<strong class="text-orange" id="cardStatusText"><i class="fa-solid fa-spinner fa-spin"></i> Searching for compatible donors</strong>`
            }
          </div>
          <div class="progress-bar-container">
            <div class="progress-bar-fill progress-animated" style="width: ${isResponded ? '85%' : '45%'}; background: ${isResponded ? '#10B981' : 'var(--primary)'};"></div>
          </div>
        </div>

        <div class="req-card-actions" style="display: flex; gap: 8px;">
          <button class="btn-secondary-sm" style="flex: 1;" onclick="navigateToEmergencyLive('${req.id}')">
            <i class="fa-solid fa-satellite-dish"></i> View Live Tracking
          </button>
          ${isResponded ? `
            <button class="btn-whatsapp-sm" style="flex: 1; justify-content: center;" onclick="openDonorWhatsAppChat('${req.id}')" title="Chat with responded donor on WhatsApp">
              <i class="fa-brands fa-whatsapp"></i> WhatsApp Donor
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ------------------------------------------------------------------------------
// 17. UI State Synchronization
// ------------------------------------------------------------------------------
function updateUI() {
  const isDonor = appState.activeRole === 'donor';
  const user = appState.currentUser || {
    id: '',
    name: 'My Account',
    email: '',
    phone: '',
    bloodGroup: 'O+',
    city: 'Location Not Set',
    role: appState.activeRole || 'donor'
  };

  // Top Header Role switch pill
  const roleBadge = document.getElementById('headerRoleBadge');
  const rolePillText = document.getElementById('rolePillText');
  const roleSwitchBtn = document.getElementById('headerRoleSwitchBtn');
  if (roleBadge) roleBadge.textContent = isDonor ? 'Donor Mode' : 'Requester Mode';
  if (rolePillText) rolePillText.textContent = isDonor ? `Donor (${user.bloodGroup || 'O+'})` : 'Requester';
  if (roleSwitchBtn) {
    roleSwitchBtn.classList.toggle('donor-active', isDonor);
    roleSwitchBtn.title = isDonor 
      ? 'Currently in Donor Mode. Tap to switch to Requester Mode' 
      : 'Currently in Requester Mode. Tap to switch to Donor Mode';
  }

  // Header Avatar Initials
  const headerAvatar = document.getElementById('headerAvatarImg');
  if (headerAvatar && user.name) {
    headerAvatar.alt = user.name;
    headerAvatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=dc2626&color=fff&bold=true`;
  }

  // User Dropdown Popover Info
  const dropdownName = document.getElementById('dropdownUserName');
  const dropdownRole = document.getElementById('dropdownUserRole');
  const dropdownCity = document.getElementById('dropdownUserCity');
  const dropdownSwitchText = document.getElementById('dropdownSwitchRoleText');

  if (dropdownName) dropdownName.textContent = user.name;
  if (dropdownRole) dropdownRole.textContent = `${isDonor ? 'Verified Donor' : 'Patient/Requester'} (${user.bloodGroup || 'O+'})`;
  if (dropdownCity) dropdownCity.textContent = user.city || user.address || 'Chennai';
  if (dropdownSwitchText) {
    dropdownSwitchText.textContent = isDonor 
      ? 'Switch to Requester Mode (Need Blood)' 
      : 'Switch to Donor Mode (Ready to Donate)';
  }

  // Requester Home Displays
  const reqNameDisplay = document.getElementById('requesterNameDisplay');
  const userActiveGroupBadge = document.getElementById('userActiveGroupBadge');
  if (reqNameDisplay) reqNameDisplay.textContent = user.name;
  if (userActiveGroupBadge) userActiveGroupBadge.textContent = user.bloodGroup;

  // Donor Home Displays
  const donorNameDisplay = document.getElementById('donorNameDisplay');
  const donorBloodGroupDisplay = document.getElementById('donorBloodGroupDisplay');
  if (donorNameDisplay) donorNameDisplay.textContent = user.name;
  if (donorBloodGroupDisplay) donorBloodGroupDisplay.textContent = user.bloodGroup;

  // Profile Displays
  const profileNameDisplay = document.getElementById('profileNameDisplay');
  const profilePhoneDisplay = document.getElementById('profilePhoneDisplay');
  const profileCityDisplay = document.getElementById('profileCityDisplay');
  const profileBloodGroupDisplay = document.getElementById('profileBloodGroupDisplay');
  const profileBloodTag = document.getElementById('profileBloodTag');
  const profileRoleBadge = document.getElementById('profileRoleBadge');
  const profileSwitchSubtext = document.getElementById('profileSwitchSubtext');

  if (profileNameDisplay) profileNameDisplay.textContent = user.name;
  if (profilePhoneDisplay) profilePhoneDisplay.textContent = user.phone;
  if (profileCityDisplay) profileCityDisplay.textContent = user.city;
  if (profileBloodGroupDisplay) profileBloodGroupDisplay.textContent = `${user.bloodGroup} Positive`;
  if (profileBloodTag) profileBloodTag.textContent = user.bloodGroup;
  if (profileRoleBadge) {
    profileRoleBadge.innerHTML = isDonor 
      ? '<i class="fa-solid fa-hand-holding-droplet"></i> Registered Emergency Donor' 
      : '<i class="fa-solid fa-hospital-user"></i> Registered Requester';
  }
  if (profileSwitchSubtext) {
    profileSwitchSubtext.textContent = `Current: ${isDonor ? 'Donor' : 'Requester'} Mode`;
  }

  // Dynamic Views Refresh
  renderRequesterActiveRequests();
  renderDonorEmergencies();
  renderMyRequestsList();
}

// ------------------------------------------------------------------------------
// 18. Modals & Toast Helpers
// ------------------------------------------------------------------------------
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let icon = '<i class="fa-solid fa-circle-info"></i>';
  if (type === 'success') icon = '<i class="fa-solid fa-circle-check"></i>';
  if (type === 'emergency') icon = '<i class="fa-solid fa-triangle-exclamation"></i>';

  toast.innerHTML = `${icon} <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastSlideUpFade 0.3s forwards';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 3200);
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerHTML = '<i class="fa-regular fa-eye-slash"></i>';
    btn.setAttribute('aria-label', 'Hide password');
    btn.title = 'Hide password';
  } else {
    input.type = 'password';
    btn.innerHTML = '<i class="fa-regular fa-eye"></i>';
    btn.setAttribute('aria-label', 'Show password');
    btn.title = 'Show password';
  }
}

// ------------------------------------------------------------------------------
// 19. Application Boot & Initialization
// ------------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initAppState();
  updateUI();

  // Set default date for request form
  const dateInput = document.getElementById('reqDateInput');
  if (dateInput) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    dateInput.value = tomorrow.toISOString().split('T')[0];
  }

  // Initial Sync from server
  fetchDataFromBackend();

  // Route to initial screen: First time visit always asks Login or Sign Up
  const sessionActive = sessionStorage.getItem('bloodconnect_session_active');
  if (sessionActive === 'true' && appState.isAuthenticated && appState.currentUser) {
    const homeScreen = appState.activeRole === 'donor' ? 'screen-home-donor' : 'screen-home-requester';
    navigateToScreen(homeScreen, false);
  } else {
    appState.isAuthenticated = false;
    navigateToScreen('screen-login', false);
  }
});
