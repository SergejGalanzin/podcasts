// app.js: the behavior of the app. Screens, search, podcast page and the player.
// It uses searchPodcasts() and getEpisodes() from directory.js.

// ===========================================================================
// Small helpers
// ===========================================================================

// Find an element on the page by its id="..." (see index.html).
const $ = (id) => document.getElementById(id);

// Create a new element, for example el("div", "row-title", "Hello").
// We always set text with textContent, never as HTML, so a podcast title can
// never sneak code into our app.
function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// Podcast descriptions often contain HTML (bold text, links...). Keep only the text.
function plainText(html) {
  return new DOMParser().parseFromString(html || "", "text/html").body.textContent.trim();
}

// 3723 seconds -> "1:02:03"; 125 seconds -> "2:05"
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return (h ? `${h}:` : "") + `${mm}:${String(s).padStart(2, "0")}`;
}

// 3723 seconds -> "1 h 2 min"; 1554 seconds -> "26 min"
function formatDuration(seconds) {
  if (!seconds) return "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

// Show a picture, or an empty grey box when the podcast has none.
function setImage(image, address) {
  if (address) image.src = address;
  else image.removeAttribute("src");
}

// A date -> "27 Sep 2026" (in your phone's time zone)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatDate(date) {
  if (!date || isNaN(date)) return "";
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

// ===========================================================================
// Screens and the back button
// ===========================================================================
// The app has two screens: "search" and "podcast". Only one is visible at a time.
//
// Android's back gesture normally means "go to the previous web page", which would
// close our app. So when we open a podcast, we add an entry to the browser's history
// (pushState). The back gesture then just removes that entry, and we show search again.

let searchScrollPosition = 0; // so the results list is where you left it

function showScreen(name) {
  $("searchScreen").hidden = name !== "search";
  $("podcastScreen").hidden = name !== "podcast";
  $("backButton").hidden = name !== "podcast";
}

// Start on the search screen.
history.replaceState({ screen: "search" }, "");
showScreen("search");

// Back gesture (or our back arrow) -> the browser fires "popstate".
window.addEventListener("popstate", () => {
  currentPodcast = null;
  showScreen("search");
  window.scrollTo(0, searchScrollPosition);
});

$("backButton").addEventListener("click", () => history.back());

// ===========================================================================
// Screen 1: Search
// ===========================================================================

let searchNumber = 0; // counts searches, so a slow old search can't overwrite a newer one

$("searchForm").addEventListener("submit", async (event) => {
  event.preventDefault(); // stop the browser from reloading the page
  const name = $("searchInput").value.trim();
  if (!name) return;

  $("searchInput").blur(); // hides the phone keyboard
  const mySearch = ++searchNumber;
  const results = $("results");
  results.replaceChildren(el("p", "muted", "Searching…"));

  const found = await searchPodcasts(name);
  if (mySearch !== searchNumber) return; // a newer search has started meanwhile

  results.replaceChildren();
  if (found.fyyd.length) {
    results.append(el("h3", "section-title", "Results"));
    found.fyyd.forEach((podcast) => results.append(podcastRow(podcast)));
  }
  if (found.apple.length) {
    results.append(el("h3", "section-title", "More results (Apple)"));
    found.apple.forEach((podcast) => results.append(podcastRow(podcast)));
  }
  if (!found.fyyd.length && !found.apple.length && !found.errors.length) {
    results.append(el("p", "muted", `Nothing found for "${name}".`));
  }
  found.errors.forEach((message) => results.append(el("p", "error", `Couldn't search ${message}`)));
});

// One podcast in the results list: picture, title, author. Tap to open it.
function podcastRow(podcast) {
  const row = el("button", "row");
  row.type = "button";
  const image = el("img");
  if (podcast.image) image.src = podcast.image;
  image.alt = "";
  image.loading = "lazy";
  const text = el("div", "row-text");
  text.append(el("div", "row-title", podcast.title), el("div", "row-sub", podcast.author));
  row.append(image, text);
  row.addEventListener("click", () => openPodcast(podcast));
  return row;
}

// ===========================================================================
// Screen 2: One podcast
// ===========================================================================

let currentPodcast = null; // the podcast whose page is open

async function openPodcast(podcast) {
  searchScrollPosition = window.scrollY;
  currentPodcast = podcast;
  history.pushState({ screen: "podcast" }, "");
  showScreen("podcast");
  window.scrollTo(0, 0);

  // Fill in the top part.
  setImage($("podcastImage"), podcast.image);
  $("podcastTitle").textContent = podcast.title;
  $("podcastAuthor").textContent = podcast.author;
  const description = $("podcastDescription");
  description.textContent = plainText(podcast.description);
  description.hidden = !description.textContent;
  description.classList.add("clamped");

  // Then load the episodes.
  const list = $("episodes");
  list.replaceChildren(el("p", "muted", "Loading episodes…"));
  try {
    const episodes = await getEpisodes(podcast);
    if (currentPodcast !== podcast) return; // you already went back
    list.replaceChildren();
    if (!episodes.length) list.append(el("p", "muted", "No episodes found."));
    episodes.forEach((episode) => list.append(episodeRow(episode, podcast)));
  } catch (error) {
    if (currentPodcast !== podcast) return;
    list.replaceChildren(el("p", "error", `Couldn't load episodes: ${error.message}.`));
  }
}

// Tap the description to show all of it (or only 4 lines again).
$("podcastDescription").addEventListener("click", (event) => {
  event.currentTarget.classList.toggle("clamped");
});

// One episode in the list: title, date and length. Tap to play it.
function episodeRow(episode, podcast) {
  const row = el("button", "row");
  row.type = "button";
  row.dataset.audio = episode.audioUrl; // lets us highlight the one that's playing
  if (episode.audioUrl === audio.src) row.classList.add("playing");
  const text = el("div", "row-text");
  const details = [formatDate(episode.date), formatDuration(episode.duration)].filter(Boolean);
  text.append(el("div", "row-title", episode.title), el("div", "row-sub", details.join(" · ")));
  row.append(text);
  row.addEventListener("click", () => playEpisode(episode, podcast));
  return row;
}

// ===========================================================================
// The player
// ===========================================================================

const audio = $("audio");
const playPauseButton = $("playPauseButton");
const seekBar = $("seekBar");
let isDraggingSeekBar = false;

function playEpisode(episode, podcast) {
  // Tell the audio element which file to play, and start.
  audio.src = episode.audioUrl;
  audio.play().catch((error) => showPlayerProblem(error));

  // Show the player bar with the episode's info.
  $("player").hidden = false;
  document.body.classList.add("has-player");
  setImage($("playerImage"), podcast.image);
  $("playerTitle").textContent = episode.title;
  $("playerPodcast").textContent = podcast.title;
  $("timeNow").textContent = "0:00";
  $("timeTotal").textContent = episode.duration ? formatTime(episode.duration) : "…";

  // Highlight the playing episode in the list.
  document.querySelectorAll("#episodes .row").forEach((row) => {
    row.classList.toggle("playing", row.dataset.audio === episode.audioUrl);
  });

  // Tell the phone what's playing, so the lock screen and notification show it.
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: episode.title,
      artist: podcast.title,
      artwork: podcast.image ? [{ src: podcast.image }] : [],
    });
  }
}

function showPlayerProblem(error) {
  // "NotAllowedError" = the browser wants a tap before playing; not a real problem.
  if (error && error.name === "NotAllowedError") return;
  $("playerPodcast").textContent = "Couldn't play this episode.";
}

// Play/pause button.
playPauseButton.addEventListener("click", () => {
  if (!audio.src) return;
  if (audio.paused) audio.play().catch(showPlayerProblem);
  else audio.pause();
});

// Keep the button icon in sync with what the audio is doing.
audio.addEventListener("play", () => playPauseButton.classList.add("is-playing"));
audio.addEventListener("pause", () => playPauseButton.classList.remove("is-playing"));
audio.addEventListener("error", () => showPlayerProblem());

// Once the file's length is known, set up the progress bar.
audio.addEventListener("loadedmetadata", () => {
  seekBar.max = Math.floor(audio.duration) || 0;
  $("timeTotal").textContent = formatTime(audio.duration);
});

// While playing, move the progress bar (unless you're dragging it).
audio.addEventListener("timeupdate", () => {
  if (isDraggingSeekBar) return;
  seekBar.value = Math.floor(audio.currentTime);
  $("timeNow").textContent = formatTime(audio.currentTime);
});

// Dragging the progress bar: show the time while dragging, jump when you let go.
seekBar.addEventListener("input", () => {
  isDraggingSeekBar = true;
  $("timeNow").textContent = formatTime(Number(seekBar.value));
});
seekBar.addEventListener("change", () => {
  audio.currentTime = Number(seekBar.value);
  isDraggingSeekBar = false;
});

// ===========================================================================
// Service worker (lets the app open without internet; see sw.js)
// ===========================================================================
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}
