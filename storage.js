// storage.js: everything the app remembers, saved on your phone only.
//
// We use the browser's "localStorage": a small box of text inside the app, on the phone.
// Nothing here is ever sent anywhere. (If you clear Chrome's data for the app, it's gone;
// the backup feature in Step 6 will cover that.)
//
// What we remember:
//   subscriptions  - the podcasts you subscribed to
//   positions      - where you stopped in each episode, and which ones you finished
//   speed          - your playback speed
//   episodeCache   - the latest episodes of your subscriptions (for the "New" list)
//   lastPlayed     - the episode in the player, so it's ready when you reopen the app
//   notes          - your voice notes

const STORAGE_PREFIX = "mypodcasts.";

// Read something from storage. If it's missing or broken, use the fallback value.
function readStored(name, fallback) {
  try {
    const text = localStorage.getItem(STORAGE_PREFIX + name);
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

// Save something to storage. (Storage can fail, e.g. when full; the app keeps working.)
function writeStored(name, value) {
  try {
    localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(value));
  } catch (error) {
    console.warn("Couldn't save", name, error);
  }
}

// Dates turn into text when saved. This turns them back into dates.
function reviveEpisode(episode) {
  return { ...episode, date: episode.date ? new Date(episode.date) : null };
}

// Ask the phone to keep our storage even when space runs low. (It may say no; that's fine.)
function askToKeepStorage() {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------
// A podcast is identified by its feed address (see feedKey() in directory.js),
// because that's the podcast's real "home", no matter which directory found it.

function getSubscriptions() {
  return readStored("subscriptions", []);
}

function isSubscribed(podcast) {
  const key = feedKey(podcast.feedUrl);
  return getSubscriptions().some((p) => feedKey(p.feedUrl) === key);
}

function subscribe(podcast) {
  if (isSubscribed(podcast)) return;
  const subscriptions = getSubscriptions();
  subscriptions.push({ ...podcast, subscribedAt: Date.now() });
  writeStored("subscriptions", subscriptions);
  askToKeepStorage();
}

function unsubscribe(podcast) {
  const key = feedKey(podcast.feedUrl);
  writeStored("subscriptions", getSubscriptions().filter((p) => feedKey(p.feedUrl) !== key));
  // Also forget its saved episodes, so it disappears from the "New" list.
  const cache = readStored("episodeCache", {});
  delete cache[key];
  writeStored("episodeCache", cache);
}

// Replace a saved podcast's picture address (used to repair broken pictures).
// Returns true if something was changed.
function updatePodcastImage(podcast, image) {
  const key = feedKey(podcast.feedUrl);
  let changed = false;
  const subscriptions = getSubscriptions();
  for (const saved of subscriptions) {
    if (feedKey(saved.feedUrl) === key && saved.image !== image) {
      saved.image = image;
      changed = true;
    }
  }
  if (changed) writeStored("subscriptions", subscriptions);

  const last = readStored("lastPlayed", null);
  if (last && feedKey(last.podcast.feedUrl) === key && last.podcast.image !== image) {
    last.podcast.image = image;
    writeStored("lastPlayed", last);
    changed = true;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Where you stopped in each episode
// ---------------------------------------------------------------------------
// Saved per audio address: { time: seconds, duration: seconds, done: true/false }

function getPosition(audioUrl) {
  return readStored("positions", {})[audioUrl] || null;
}

function savePosition(audioUrl, time, duration, done = false) {
  const positions = readStored("positions", {});
  positions[audioUrl] = { time: Math.floor(time), duration: Math.floor(duration || 0), done, at: Date.now() };
  // Keep the list from growing forever: remember the 500 most recent episodes.
  const entries = Object.entries(positions);
  if (entries.length > 500) {
    entries.sort((a, b) => b[1].at - a[1].at);
    writeStored("positions", Object.fromEntries(entries.slice(0, 500)));
  } else {
    writeStored("positions", positions);
  }
}

// ---------------------------------------------------------------------------
// Playback speed
// ---------------------------------------------------------------------------

function getSpeed() {
  return readStored("speed", 1);
}

function saveSpeed(speed) {
  writeStored("speed", speed);
}

// ---------------------------------------------------------------------------
// Latest episodes of each subscription (for the "New" list)
// ---------------------------------------------------------------------------
// Saved per podcast: { at: when we checked, episodes: [the newest 30] }

const EPISODES_TO_KEEP = 30;

function getCachedEpisodes(podcast) {
  const entry = readStored("episodeCache", {})[feedKey(podcast.feedUrl)];
  return entry ? { at: entry.at, episodes: entry.episodes.map(reviveEpisode) } : null;
}

function saveCachedEpisodes(podcast, episodes) {
  if (!isSubscribed(podcast)) return; // only for podcasts you follow
  const cache = readStored("episodeCache", {});
  cache[feedKey(podcast.feedUrl)] = { at: Date.now(), episodes: episodes.slice(0, EPISODES_TO_KEEP) };
  writeStored("episodeCache", cache);
}

// ---------------------------------------------------------------------------
// The episode in the player
// ---------------------------------------------------------------------------

function getLastPlayed() {
  const last = readStored("lastPlayed", null);
  return last ? { podcast: last.podcast, episode: reviveEpisode(last.episode) } : null;
}

function saveLastPlayed(episode, podcast) {
  writeStored("lastPlayed", { episode, podcast });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
// A note: { id, text, createdAt, podcast, episode, position }
// podcast / episode / position say what you were listening to (empty if nothing was playing).

function getNotes() {
  return readStored("notes", []).map((note) => ({
    ...note,
    episode: note.episode ? reviveEpisode(note.episode) : null,
  }));
}

function addNote(text, context) {
  const notes = readStored("notes", []);
  notes.unshift({
    id: String(Date.now()),
    text,
    createdAt: Date.now(),
    podcast: context ? context.podcast : null,
    episode: context ? context.episode : null,
    position: context ? context.position : 0,
  });
  writeStored("notes", notes);
  askToKeepStorage();
}

function updateNote(id, text) {
  const notes = readStored("notes", []);
  const note = notes.find((n) => n.id === id);
  if (note) note.text = text;
  writeStored("notes", notes);
}

function deleteNote(id) {
  writeStored("notes", readStored("notes", []).filter((n) => n.id !== id));
}
