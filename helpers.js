// helpers.js: small tools used by the other files (creating elements, formatting times and dates).

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

// Show a picture, or an empty grey box when there is none.
function setImage(image, address) {
  if (address) image.src = address;
  else image.removeAttribute("src");
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
  if (!seconds || seconds < 0) return "";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

// A date -> "27 Sep 2026" (in your phone's time zone)
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatDate(date) {
  if (!date || isNaN(date)) return "";
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

// A clock time -> "16:42"
function formatClock(date) {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// Run a task for every item, but at most `limit` at the same time
// (so we don't ask for 30 feeds at once).
async function runLimited(items, limit, task) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await task(queue.shift());
  });
  await Promise.all(workers);
}
