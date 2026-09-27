// player.js: the audio player.
// Play/pause, skip back 15 s / forward 30 s, speed, the progress bar,
// remembering where you stopped, and the controls on the lock screen.
//
// app.js only calls playEpisode(episode, podcast) and episodeStatus(episode).
// When something changes (new episode, finished...), this file announces
// "player-changed" so app.js can update the lists.

const audio = $("audio");
const SKIP_BACK = 15; // seconds
const SKIP_FORWARD = 30; // seconds
const SPEEDS = [0.8, 1, 1.25, 1.5, 1.75, 2];
const SAVE_EVERY = 5000; // save the position every 5 seconds while playing
const ALMOST_DONE = 20; // stopping with less than 20 s left counts as "played"

let nowPlaying = null; // { episode, podcast } that's in the player
let startAt = null; // where to jump once the audio file is ready (resume)
let lastSaveTime = 0;
let isDraggingSeekBar = false;

function announceChange() {
  document.dispatchEvent(new CustomEvent("player-changed"));
}

// ---------------------------------------------------------------------------
// Putting an episode into the player
// ---------------------------------------------------------------------------

function loadEpisode(episode, podcast, autoplay) {
  nowPlaying = { episode, podcast };
  saveLastPlayed(episode, podcast);

  // Resume: if you stopped somewhere in the middle before, start there.
  const saved = getPosition(episode.audioUrl);
  startAt = saved && !saved.done && saved.time > 5 ? saved.time : null;

  audio.src = episode.audioUrl;
  audio.defaultPlaybackRate = audio.playbackRate = getSpeed();

  // Fill in the player bar.
  $("player").hidden = false;
  document.body.classList.add("has-player");
  setImage($("playerImage"), podcast.image);
  $("playerTitle").textContent = episode.title;
  $("playerPodcast").textContent = podcast.title;
  $("timeNow").textContent = formatTime(startAt || 0);
  $("timeTotal").textContent = episode.duration ? formatTime(episode.duration) : "…";
  seekBar.max = episode.duration || 0;
  seekBar.value = startAt || 0;
  updateProgressLine();

  // Tell the phone what's playing (lock screen and notification).
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: episode.title,
      artist: podcast.title,
      artwork: podcast.image ? [{ src: podcast.image }] : [],
    });
  }

  if (autoplay) audio.play().catch(showPlayerProblem);
  announceChange();
}

// Called by app.js when you tap an episode.
function playEpisode(episode, podcast) {
  // Tapping the episode that's already in the player: just play/pause it.
  if (nowPlaying && nowPlaying.episode.audioUrl === episode.audioUrl) {
    togglePlay();
    return;
  }
  savePositionNow(); // remember where you were in the previous episode
  loadEpisode(episode, podcast, true);
}

// When the app opens: put the last episode back into the player, paused.
function restoreLastPlayed() {
  const last = getLastPlayed();
  if (last && last.episode.audioUrl) loadEpisode(last.episode, last.podcast, false);
}

function togglePlay() {
  if (!audio.src) return;
  if (audio.paused) audio.play().catch(showPlayerProblem);
  else audio.pause();
}

function showPlayerProblem(error) {
  // "NotAllowedError" = the browser wants a tap before playing; not a real problem.
  if (error && error.name === "NotAllowedError") return;
  // "AbortError" = we switched to another episode before this one started; fine.
  if (error && error.name === "AbortError") return;
  $("playerPodcast").textContent = "Couldn't play this episode.";
}

// ---------------------------------------------------------------------------
// Remembering where you stopped
// ---------------------------------------------------------------------------

function savePositionNow() {
  // Only when the file is ready; before that the position would wrongly read 0.
  if (!nowPlaying || audio.readyState < 1 || startAt !== null) return;
  const time = audio.currentTime;
  const duration = audio.duration || nowPlaying.episode.duration;
  const done = duration > 0 && duration - time < ALMOST_DONE;
  savePosition(nowPlaying.episode.audioUrl, done ? 0 : time, duration, done);
}

// Once the file is ready: jump to the saved position, set up the progress bar.
audio.addEventListener("loadedmetadata", () => {
  if (startAt !== null) {
    audio.currentTime = startAt;
    startAt = null;
  }
  seekBar.max = Math.floor(audio.duration) || 0;
  $("timeTotal").textContent = formatTime(audio.duration);
  updatePositionState();
});

audio.addEventListener("timeupdate", () => {
  if (!isDraggingSeekBar && startAt === null) {
    seekBar.value = Math.floor(audio.currentTime);
    $("timeNow").textContent = formatTime(audio.currentTime);
    updateProgressLine();
  }
  if (!audio.paused && Date.now() - lastSaveTime > SAVE_EVERY) {
    lastSaveTime = Date.now();
    savePositionNow();
  }
});

audio.addEventListener("play", () => {
  playPauseButton.classList.add("is-playing");
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  updatePositionState();
});

audio.addEventListener("pause", () => {
  playPauseButton.classList.remove("is-playing");
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  savePositionNow();
  announceChange(); // so the lists show "... min left"
});

audio.addEventListener("ended", () => {
  if (nowPlaying) savePosition(nowPlaying.episode.audioUrl, 0, audio.duration, true);
  announceChange(); // so the lists show "Played"
});

audio.addEventListener("error", () => {
  if (audio.src) showPlayerProblem();
});

audio.addEventListener("seeked", updatePositionState);
audio.addEventListener("ratechange", updatePositionState);

// When you leave the app (home button, lock screen, switch apps), save right away.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") savePositionNow();
});

// Status text for an episode in a list: "Played", "23 min left" or nothing.
function episodeStatus(episode) {
  const saved = getPosition(episode.audioUrl);
  if (!saved) return "";
  if (saved.done) return "Played";
  const duration = saved.duration || episode.duration;
  if (saved.time > 5 && duration) return `${formatDuration(duration - saved.time)} left`;
  return "";
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

const playPauseButton = $("playPauseButton");
const seekBar = $("seekBar");
const speedButton = $("speedButton");

playPauseButton.addEventListener("click", togglePlay);

function skip(seconds) {
  if (!audio.src || !isFinite(audio.duration)) return;
  audio.currentTime = Math.min(Math.max(0, audio.currentTime + seconds), audio.duration);
}
$("skipBackButton").addEventListener("click", () => skip(-SKIP_BACK));
$("skipForwardButton").addEventListener("click", () => skip(SKIP_FORWARD));

// Speed: each tap goes to the next speed in the list, then back to the start.
function showSpeed() {
  speedButton.textContent = `${getSpeed()}×`;
}
speedButton.addEventListener("click", () => {
  const next = SPEEDS[(SPEEDS.indexOf(getSpeed()) + 1) % SPEEDS.length];
  saveSpeed(next);
  audio.defaultPlaybackRate = audio.playbackRate = next;
  showSpeed();
});
showSpeed();

// Progress bar: show the time while dragging, jump when you let go.
seekBar.addEventListener("input", () => {
  isDraggingSeekBar = true;
  $("timeNow").textContent = formatTime(Number(seekBar.value));
});
seekBar.addEventListener("change", () => {
  if (audio.readyState >= 1) audio.currentTime = Number(seekBar.value);
  else startAt = Number(seekBar.value); // file not ready yet: jump once it is
  isDraggingSeekBar = false;
});

// The thin line at the top of the small player shows progress too.
function updateProgressLine() {
  const max = Number(seekBar.max) || 0;
  const part = max ? Number(seekBar.value) / max : 0;
  $("progressLine").style.width = `${Math.min(100, part * 100)}%`;
}

// Small / big player: tap the arrow to show or hide the extra controls.
function setPlayerExpanded(expanded) {
  document.body.classList.toggle("player-expanded", expanded);
  $("expandButton").setAttribute("aria-expanded", String(expanded));
  writeStored("playerExpanded", expanded);
}
$("expandButton").addEventListener("click", () => {
  setPlayerExpanded(!document.body.classList.contains("player-expanded"));
});
setPlayerExpanded(readStored("playerExpanded", true));

// ---------------------------------------------------------------------------
// Lock screen and notification controls
// ---------------------------------------------------------------------------

function updatePositionState() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  const duration = audio.duration;
  if (!isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: audio.playbackRate,
      position: Math.min(audio.currentTime, duration),
    });
  } catch {
    // some phones don't support this; the buttons still work
  }
}

if ("mediaSession" in navigator) {
  const actions = {
    play: () => audio.play(),
    pause: () => audio.pause(),
    seekbackward: (details) => skip(-(details.seekOffset || SKIP_BACK)),
    seekforward: (details) => skip(details.seekOffset || SKIP_FORWARD),
    seekto: (details) => {
      audio.currentTime = details.seekTime;
      updatePositionState();
    },
  };
  for (const [action, handler] of Object.entries(actions)) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // this phone doesn't know this action; skip it
    }
  }
}
