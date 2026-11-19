
const WORKOUT_SECONDS = 15; // 15 seconds for testing
const COUNTDOWN_SECONDS = 3;
const CUSTOM_SOUND_CHANCE = 0.2;

const CUSTOM_SOUNDS = {
  beep: "sounds/custom-beep.m4a",
  buzzer: "sounds/custom-buzzer.m4a"
};

const timerDisplay = document.getElementById("timer");
const lapCountDisplay = document.getElementById("lap-count");
const lastLapDisplay = document.getElementById("last-lap");
const statusDisplay = document.getElementById("status");
const startButton = document.getElementById("start-button");
const lapButton = document.getElementById("lap-button");
const endButton = document.getElementById("end-button");

let state = "ready";
let workoutStart = null;
let lastLapTime = null;
let laps = [];

let workoutId = null;
let workoutDate = null;
let workoutStartWallTime = null;
let previousPersonalBest = null;
let previousWorkoutCount = 0;
let confettiBuffer = null;

let countdownEnd = null;
let countdownInterval = null;
let timerInterval = null;

let audioContext = null;
let soundBuffers = {};
let soundLoadingPromise = null;
let wakeLock = null;


async function loadWorkoutStats() {
  const workouts = await getWorkouts();

  previousWorkoutCount = workouts.length;
  previousPersonalBest = await getPersonalBest();

  document.getElementById("personal-best").textContent =
    previousPersonalBest ?? "--";
}

async function loadConfettiSound() {
  if (!audioContext || confettiBuffer) return;

  try {
    const response = await fetch("sounds/custom-woow.m4a");

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.arrayBuffer();
    confettiBuffer = await audioContext.decodeAudioData(data);
  } catch (error) {
    console.warn("Could not load confetti sound:", error);
  }
}

function playConfettiSound() {
  if (!audioContext || !confettiBuffer) return;

  const source = audioContext.createBufferSource();
  source.buffer = confettiBuffer;
  source.connect(audioContext.destination);
  source.start();
}

async function saveCurrentWorkout(completed) {
  if (!workoutId) return;

  const elapsedSeconds = completed
    ? WORKOUT_SECONDS
    : Math.min(
        WORKOUT_SECONDS,
        (performance.now() - workoutStart) / 1000
      );

  const workout = {
    id: workoutId,
    schemaVersion: BACKUP_FORMAT_VERSION,
    date: workoutDate,
    durationSeconds: WORKOUT_SECONDS,
    elapsedSeconds,
    completed,
    totalLaps: laps.length,
    laps: [...laps]
  };

  await saveWorkout(workout);
  await clearActiveWorkout();

  return workout;
}


// --------------------
// TIME FORMATTING
// --------------------

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);

  return (
    String(minutes).padStart(2, "0") +
    ":" +
    String(remaining).padStart(2, "0")
  );
}

// --------------------
// AUDIO
// --------------------

function initializeAudio() {
  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) return;

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(console.warn);
  }

  // Start loading custom recordings once.
  if (!soundLoadingPromise) {
    soundLoadingPromise = loadCustomSounds();
  }

  loadConfettiSound();
}

async function loadCustomSounds() {
  for (const [name, path] of Object.entries(CUSTOM_SOUNDS)) {
    try {
      const response = await fetch(path);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.arrayBuffer();

      soundBuffers[name] =
        await audioContext.decodeAudioData(data);

      console.log(`Loaded custom ${name}`);
    } catch (error) {
      console.warn(`Custom ${name} unavailable:`, error);
    }
  }
}

function playTone(frequency, duration, type = "sine") {
  if (!audioContext || audioContext.state !== "running") {
    return;
  }

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = type;
  oscillator.frequency.value = frequency;

  const now = audioContext.currentTime;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    now + duration
  );

  oscillator.connect(gain);
  gain.connect(audioContext.destination);

  oscillator.start(now);
  oscillator.stop(now + duration);
}

function playCustomSound(name) {
  if (!audioContext || audioContext.state !== "running") {
    return false;
  }

  const buffer = soundBuffers[name];
  if (!buffer) return false;

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.start();

  return true;
}

function playStartBeep() {
  if (
    Math.random() < CUSTOM_SOUND_CHANCE &&
    playCustomSound("beep")
  ) {
    return;
  }

  playTone(880, 0.35);
}

function playEndBuzzer() {
  if (
    Math.random() < CUSTOM_SOUND_CHANCE &&
    playCustomSound("buzzer")
  ) {
    return;
  }

  playTone(220, 1.5, "sawtooth");
}

// --------------------
// SCREEN WAKE LOCK
// --------------------

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  if (wakeLock) return;

  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch (error) {
    console.warn("Wake lock unavailable:", error);
  }
}

async function releaseWakeLock() {
  if (!wakeLock) return;

  const lock = wakeLock;
  wakeLock = null;

  try {
    await lock.release();
  } catch (error) {
    console.warn("Could not release wake lock:", error);
  }
}

// --------------------
// WORKOUT TIMER
// --------------------

function updateTimer() {
  if (state !== "running") return;

  const elapsed =
    (performance.now() - workoutStart) / 1000;

  const remaining =
    Math.max(0, WORKOUT_SECONDS - elapsed);

  timerDisplay.textContent =
    formatTime(Math.ceil(remaining));

  if (remaining <= 0) {
    finishWorkout();
  }
}

function beginWorkout() {
  if (state !== "countdown") return;

  clearInterval(countdownInterval);

  state = "running";

  workoutId = crypto.randomUUID();
  workoutDate = new Date().toISOString();
  workoutStartWallTime = Date.now();

  saveActiveWorkout({
  id: "current",
  workoutId,
  date: workoutDate,
  startTime: workoutStartWallTime,
  laps: []
  }).catch(console.error);

  workoutStart = performance.now();
  lastLapTime = workoutStart;
  laps = [];

  lapCountDisplay.textContent = "0";
  lastLapDisplay.textContent = "--";
  timerDisplay.textContent =
    formatTime(WORKOUT_SECONDS);

  statusDisplay.textContent = "Workout in progress";
  lapButton.disabled = false;

  playStartBeep();
  requestWakeLock();

  timerInterval = setInterval(updateTimer, 100);
  endButton.hidden = false;
}

function updateCountdown() {
  if (state !== "countdown") return;

  const remaining =
    Math.ceil((countdownEnd - performance.now()) / 1000);

  if (remaining <= 0) {
    beginWorkout();
  } else {
    timerDisplay.textContent = remaining;
  }
}

function startCountdown() {
  if (state !== "ready") return;

  initializeAudio();
  requestWakeLock();

  state = "countdown";
  startButton.disabled = true;
  lapButton.disabled = true;

  statusDisplay.textContent = "Get ready!";

  countdownEnd =
    performance.now() + COUNTDOWN_SECONDS * 1000;

  timerDisplay.textContent = COUNTDOWN_SECONDS;

  countdownInterval =
    setInterval(updateCountdown, 50);
}

// --------------------
// LAP TRACKING
// --------------------

function recordLap() {
  if (state !== "running") return;

  const now = performance.now();

  const elapsed =
    (now - workoutStart) / 1000;

  if (elapsed >= WORKOUT_SECONDS) {
    finishWorkout();
    return;
  }

  const lapTime =
    (now - lastLapTime) / 1000;

  laps.push({
    lap: laps.length + 1,
    elapsedSeconds: elapsed,
    lapTimeSeconds: lapTime
  });

  lastLapTime = now;

  lapCountDisplay.textContent = laps.length;
  lastLapDisplay.textContent =
    `${lapTime.toFixed(1)}s`;
    
  saveActiveWorkout({
    id: "current",
    workoutId,
    date: workoutDate,
    startTime: workoutStartWallTime,
    laps: [...laps]
  }).catch(console.error);
}

// --------------------
// FINISH AND RESET
// --------------------


async function finishWorkout(completed = true) {
  if (state !== "running") return;

  state = "finished";
  endButton.hidden = true;

  clearInterval(timerInterval);
  clearInterval(countdownInterval);

  timerDisplay.textContent = completed
    ? "00:00"
    : formatTime(
        Math.max(
          0,
          WORKOUT_SECONDS -
            (performance.now() - workoutStart) / 1000
        )
      );

  lapButton.disabled = true;
  startButton.disabled = true;

  releaseWakeLock();
  playEndBuzzer();

  try {
    const workout = await saveCurrentWorkout(completed);

    const newRecord =
      completed &&
      (previousPersonalBest === null ||
        workout.totalLaps > previousPersonalBest);

    if (newRecord && previousWorkoutCount >= 3) {
      setTimeout(playConfettiSound, 1700);
    }

    await loadWorkoutStats();

    statusDisplay.textContent = completed
      ? `Workout complete! ${workout.totalLaps} laps recorded.`
      : `Partial workout saved! ${workout.totalLaps} laps recorded.`;
  } catch (error) {
    console.error("Could not save workout:", error);
    statusDisplay.textContent =
      "Workout ended, but saving failed. Do not reload.";
  }

  startButton.textContent = "START NEW WORKOUT";
  startButton.disabled = false;
}


function resetWorkout() {
  clearInterval(timerInterval);
  clearInterval(countdownInterval);

  releaseWakeLock();

  state = "ready";
  workoutStart = null;
  lastLapTime = null;
  laps = [];

  timerDisplay.textContent =
    formatTime(WORKOUT_SECONDS);

  lapCountDisplay.textContent = "0";
  lastLapDisplay.textContent = "--";

  lapButton.disabled = true;
  startButton.disabled = false;
  startButton.textContent = "START WORKOUT";

  statusDisplay.textContent = "Ready to start";
  endButton.hidden = true;
  workoutId = null;
}

// --------------------
// EVENT LISTENERS
// --------------------

startButton.addEventListener("click", () => {
  if (state === "finished") {
    resetWorkout();
  }

  startCountdown();
});

lapButton.addEventListener("click", recordLap);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;

  if (state === "countdown") {
    requestWakeLock();
    updateCountdown();
  }

  if (state === "running") {
    updateTimer();

    if (state === "running") {
      requestWakeLock();
    }
  }
});


endButton.addEventListener("click", () => {
  if (state !== "running") return;

  if (confirm("End this workout early and save your progress?")) {
    finishWorkout(false);
  }
});

loadWorkoutStats().catch(console.error);