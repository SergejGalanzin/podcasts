// app.js: the screens and what happens when you tap.
// It uses helpers.js (small tools), directory.js (searching, episodes),
// storage.js (what's saved on the phone) and player.js (the audio player).
//
// Screens:  "library" = My Podcasts,  "new" = New episodes,  "search" = Search,
//           "podcast" = one podcast's page (opened from any of the three).

const TABS = ["library", "new", "search"];
const REFRESH_AFTER = 30 * 60 * 1000; // re-check a podcast for new episodes after 30 minutes
const NEW_LIST_LENGTH = 60;

let currentTab = "library"; // the tab you're on (or came from, when a podcast is open)
let currentPodcast = null; // the podcast whose page is open
const scrollPositions = {}; // where you were in each tab's list

// ===========================================================================
// Showing screens, tabs, and the back button / back gesture
// ===========================================================================
// Every screen change is noted in the browser's "history". That's what makes
// Android's back gesture, our back arrow and our swipe work:
//   - switching tabs REPLACES the current note (tabs don't pile up)
//   - opening a podcast ADDS a note, so "back" returns to where you were

function showScreen(name) {
  for (const screen of ["library", "new", "search", "podcast"]) {
    $(`${screen}Screen`).hidden = screen !== name;
  }
  $("backButton").hidden = name !== "podcast";
  if (TABS.includes(name)) {
    currentTab = name;
    currentPodcast = null;
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === name);
    });
  }
  if (name === "library") drawLibrary();
  if (name === "new") showNew();
}

// Show a tab and put you back where you were in its list.
function goToTab(name) {
  showScreen(name);
  window.scrollTo(0, scrollPositions[name] || 0);
}

// Tapping a tab in the bottom bar.
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const name = tab.dataset.tab;
    const onThisTabAlready = history.state && history.state.screen === name;
    scrollPositions[currentTab] = window.scrollY;
    if (onThisTabAlready) scrollPositions[name] = 0; // tapping the same tab again: jump to the top
    history.replaceState({ screen: name }, "");
    goToTab(name);
    if (name === "search" && !$("searchInput").value) $("searchInput").focus();
  });
});

// "Back" (gesture, arrow or swipe) -> the browser goes one note back -> "popstate".
window.addEventListener("popstate", (event) => {
  const state = event.state || { screen: "library" };
  if (state.screen === "podcast") openPodcast(state.podcast, false);
  else goToTab(state.screen);
});

function goBack() {
  // Only go back from a podcast page, so "back" can never close the app by accident.
  if (history.state && history.state.screen === "podcast") history.back();
}
$("backButton").addEventListener("click", goBack);

// ---------------------------------------------------------------------------
// Swipe right to go back (on a podcast page)
// ---------------------------------------------------------------------------
// Android's own back gesture only works if the swipe starts exactly at the screen
// edge. This lets you swipe right from anywhere on the podcast page.
// When the finger lifts we check: far enough to the right, mostly sideways
// (not scrolling), and quick enough?

const SWIPE_MIN_DISTANCE = 80; // pixels to the right
const SWIPE_MAX_TIME = 700; // milliseconds
const SCREEN_EDGE = 24; // leave the very edge to Android's own back gesture
let swipeStart = null;

document.addEventListener(
  "touchstart",
  (event) => {
    const touch = event.touches[0];
    // Only on a podcast page. Ignore two-finger touches (zooming), touches at the
    // very edge, and touches on the player or the tab bar.
    if (
      $("podcastScreen").hidden ||
      event.touches.length !== 1 ||
      touch.clientX < SCREEN_EDGE ||
      event.target.closest("#player, #tabBar")
    ) {
      swipeStart = null;
      return;
    }
    swipeStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  },
  { passive: true } // tells the browser we never block scrolling
);

document.addEventListener(
  "touchend",
  (event) => {
    if (!swipeStart) return;
    const touch = event.changedTouches[0];
    const toTheRight = touch.clientX - swipeStart.x;
    const upOrDown = Math.abs(touch.clientY - swipeStart.y);
    const quickEnough = Date.now() - swipeStart.time < SWIPE_MAX_TIME;
    swipeStart = null;
    if (toTheRight > SWIPE_MIN_DISTANCE && upOrDown < toTheRight / 2 && quickEnough) goBack();
  },
  { passive: true }
);
document.addEventListener("touchcancel", () => (swipeStart = null));

// ===========================================================================
// Lists: a podcast tile, a podcast row, an episode row
// ===========================================================================

// A podcast in the My Podcasts grid: big picture with the title below.
function podcastTile(podcast) {
  const tile = el("button", "tile");
  tile.type = "button";
  const image = el("img");
  setImage(image, podcast.image);
  image.alt = "";
  image.loading = "lazy";
  tile.append(image, el("div", "tile-title", podcast.title));
  tile.addEventListener("click", () => openPodcast(podcast));
  return tile;
}

// A podcast in the search results: picture, title, author.
function podcastRow(podcast) {
  const row = el("button", "row");
  row.type = "button";
  const image = el("img");
  setImage(image, podcast.image);
  image.alt = "";
  image.loading = "lazy";
  const text = el("div", "row-text");
  text.append(el("div", "row-title", podcast.title), el("div", "row-sub", podcast.author));
  if (isSubscribed(podcast)) text.append(el("div", "row-badge", "Subscribed"));
  row.append(image, text);
  row.addEventListener("click", () => openPodcast(podcast));
  return row;
}

// An episode: title, and a line like "27 Sep 2026 · 26 min · 12 min left".
// In the New list it also shows the podcast's picture and name.
const episodeRows = new WeakMap(); // remembers which episode each row shows

function episodeRow(episode, podcast, showPodcast = false) {
  const row = el("button", "row episode");
  row.type = "button";
  row.dataset.audio = episode.audioUrl;
  episodeRows.set(row, { episode, podcast, showPodcast });
  row.addEventListener("click", () => playEpisode(episode, podcast));
  fillEpisodeRow(row);
  return row;
}

function fillEpisodeRow(row) {
  const { episode, podcast, showPodcast } = episodeRows.get(row);
  const status = episodeStatus(episode);
  const details = [
    showPodcast ? podcast.title : "",
    formatDate(episode.date),
    formatDuration(episode.duration),
    status,
  ].filter(Boolean);

  row.replaceChildren();
  if (showPodcast) {
    const image = el("img", "small");
    setImage(image, podcast.image);
    image.alt = "";
    image.loading = "lazy";
    row.append(image);
  }
  const text = el("div", "row-text");
  text.append(el("div", "row-title", episode.title), el("div", "row-sub", details.join(" · ")));
  row.append(text);
  row.classList.toggle("played", status === "Played");
  row.classList.toggle("playing", !!nowPlaying && nowPlaying.episode.audioUrl === episode.audioUrl);
}

// When the player changes (other episode, paused, finished), update all visible episode rows.
document.addEventListener("player-changed", () => {
  document.querySelectorAll(".row.episode").forEach((row) => {
    if (episodeRows.has(row)) fillEpisodeRow(row);
  });
});

// ===========================================================================
// Screen: My Podcasts
// ===========================================================================

function drawLibrary() {
  const grid = $("libraryGrid");
  const subscriptions = getSubscriptions().sort((a, b) => a.title.localeCompare(b.title));
  grid.replaceChildren(...subscriptions.map(podcastTile));
  $("libraryEmpty").hidden = subscriptions.length > 0;
}

$("findPodcastsButton").addEventListener("click", () => {
  document.querySelector('.tab[data-tab="search"]').click();
});

// ===========================================================================
// Screen: New episodes
// ===========================================================================

let isRefreshing = false;

function showNew() {
  drawNew();
  refreshSubscriptions(false);
}

// Draw the list from what's saved on the phone (instant, works offline).
function drawNew() {
  const subscriptions = getSubscriptions();
  const items = [];
  for (const podcast of subscriptions) {
    const cached = getCachedEpisodes(podcast);
    if (cached) cached.episodes.forEach((episode) => items.push({ episode, podcast }));
  }
  items.sort((a, b) => (b.episode.date || 0) - (a.episode.date || 0));

  const list = $("newList");
  list.replaceChildren(
    ...items.slice(0, NEW_LIST_LENGTH).map((item) => episodeRow(item.episode, item.podcast, true))
  );
  $("newEmpty").hidden = subscriptions.length > 0;
  $("refreshButton").hidden = subscriptions.length === 0;
}

// Ask the directories for the latest episodes of your subscriptions.
// force = true: check all of them now (Refresh button).
// force = false: only those not checked in the last 30 minutes.
async function refreshSubscriptions(force) {
  if (isRefreshing) return;
  const due = getSubscriptions().filter((podcast) => {
    const cached = getCachedEpisodes(podcast);
    return force || !cached || Date.now() - cached.at > REFRESH_AFTER;
  });
  if (!due.length) return;

  isRefreshing = true;
  $("refreshButton").disabled = true;
  $("newStatus").textContent = `Checking ${due.length} podcast${due.length > 1 ? "s" : ""}…`;
  const failed = [];

  await runLimited(due, 3, async (podcast) => {
    try {
      saveCachedEpisodes(podcast, await getEpisodes(podcast));
    } catch {
      failed.push(podcast.title);
    }
  });

  isRefreshing = false;
  $("refreshButton").disabled = false;
  $("newStatus").textContent =
    `Updated ${formatClock(new Date())}` + (failed.length ? ` · couldn't check: ${failed.join(", ")}` : "");
  if (!$("newScreen").hidden) drawNew();
}

$("refreshButton").addEventListener("click", () => refreshSubscriptions(true));

// ===========================================================================
// Screen: Search
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

// ===========================================================================
// Screen: One podcast
// ===========================================================================

let loadedEpisodes = []; // the episodes shown on the open podcast page

async function openPodcast(podcast, addToHistory = true) {
  if (addToHistory) {
    scrollPositions[currentTab] = window.scrollY;
    history.pushState({ screen: "podcast", podcast }, "");
  }
  showScreen("podcast");
  currentPodcast = podcast;
  window.scrollTo(0, 0);

  // Top part: picture, title, author, Subscribe button, description.
  setImage($("podcastImage"), podcast.image);
  $("podcastTitle").textContent = podcast.title;
  $("podcastAuthor").textContent = podcast.author;
  showSubscribeButton(podcast);
  const description = $("podcastDescription");
  description.textContent = plainText(podcast.description);
  description.hidden = !description.textContent;
  description.classList.add("clamped");

  // Episodes: show the saved copy right away (if we have one), then get fresh ones.
  const list = $("episodes");
  const cached = getCachedEpisodes(podcast);
  loadedEpisodes = cached ? cached.episodes : [];
  if (cached) list.replaceChildren(...cached.episodes.map((e) => episodeRow(e, podcast)));
  else list.replaceChildren(el("p", "muted", "Loading episodes…"));

  try {
    const episodes = await getEpisodes(podcast);
    if (currentPodcast !== podcast) return; // you already left this page
    loadedEpisodes = episodes;
    saveCachedEpisodes(podcast, episodes); // only saves if you're subscribed
    list.replaceChildren(...episodes.map((e) => episodeRow(e, podcast)));
    if (!episodes.length) list.append(el("p", "muted", "No episodes found."));
  } catch (error) {
    if (currentPodcast !== podcast) return;
    const message = el("p", "error", `Couldn't load episodes: ${error.message}.`);
    if (cached) list.prepend(el("p", "muted", "Showing the saved list."), message);
    else list.replaceChildren(message);
  }
}

// Subscribe / Subscribed button.
function showSubscribeButton(podcast) {
  const button = $("subscribeButton");
  const subscribed = isSubscribed(podcast);
  button.textContent = subscribed ? "Subscribed ✓" : "Subscribe";
  button.classList.toggle("subscribed", subscribed);
}

$("subscribeButton").addEventListener("click", () => {
  const podcast = currentPodcast;
  if (!podcast) return;
  if (isSubscribed(podcast)) {
    unsubscribe(podcast);
  } else {
    subscribe(podcast);
    if (loadedEpisodes.length) saveCachedEpisodes(podcast, loadedEpisodes);
  }
  showSubscribeButton(podcast);
});

// Tap the description to show all of it (or only 4 lines again).
$("podcastDescription").addEventListener("click", (event) => {
  event.currentTarget.classList.toggle("clamped");
});

// ===========================================================================
// Start the app
// ===========================================================================

history.replaceState({ screen: "library" }, "");
goToTab("library");
restoreLastPlayed(); // the last episode waits in the player, paused
refreshSubscriptions(false); // quietly check for new episodes in the background

// Service worker: lets the app open without internet (see sw.js).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}
