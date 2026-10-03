// directory.js: everything that talks to the podcast directories (fyyd and Apple).
//
// The rest of the app never talks to fyyd or Apple directly. It only uses the two
// functions at the bottom of this file: searchPodcasts() and getEpisodes().
// That way, if we ever switch directories, only this file changes.
//
// fyyd and Apple answer in different formats, so every answer is converted into
// one common format ("shape"), and the rest of the app doesn't care where data came from:
//
//   a podcast:  { source: "fyyd" or "apple", id, title, author, image, feedUrl, description }
//   an episode: { title, date, duration (in seconds), audioUrl, description }

const FYYD_API = "https://api.fyyd.de/0.2";
const APPLE_API = "https://itunes.apple.com";
const HOW_MANY_RESULTS = 10;
const HOW_MANY_EPISODES = 50;

// Newest known picture address per podcast (filled in by fyydEpisodes below).
const freshImages = new Map();

// fyyd's own picture server refuses to show pictures inside other websites.
function isBlockedImage(address) {
  return /fyyd\.de\/pd\//.test(address || "");
}

// Helper: fetch a web address and read the answer as JSON (structured data).
async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${new URL(url).host} answered with error ${response.status}`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// fyyd (independent German podcast directory; no key needed)
// ---------------------------------------------------------------------------

async function searchFyyd(name) {
  const data = await getJson(
    `${FYYD_API}/search/podcast?title=${encodeURIComponent(name)}&count=${HOW_MANY_RESULTS}`
  );
  // fyyd puts the list in "data". Convert each entry to our common shape.
  return (data.data || []).map((p) => ({
    source: "fyyd",
    id: p.id,
    title: p.title || "(no title)",
    author: p.author || "",
    // imgURL is the podcaster's original picture. fyyd's own resized copies
    // (smallImageURL...) can't be shown inside other websites, so we don't use them.
    image: p.imgURL || "",
    feedUrl: p.xmlURL,
    description: p.description || "",
  }));
}

async function fyydEpisodes(podcast) {
  const data = await getJson(
    `${FYYD_API}/podcast/episodes?podcast_id=${podcast.id}&count=${HOW_MANY_EPISODES}`
  );
  const episodes = (data.data && data.data.episodes) || [];
  // The answer also contains the podcast's current picture address. Remember it,
  // so a saved subscription with an old or broken picture can be repaired.
  if (data.data && data.data.imgURL) freshImages.set(feedKey(podcast.feedUrl), data.data.imgURL);
  return episodes.map((e) => ({
    title: e.title || "(no title)",
    date: e.pubdate ? new Date(e.pubdate) : null,
    duration: Number(e.duration) || 0,
    audioUrl: e.enclosure, // "enclosure" = the link to the audio file
    description: e.description || "",
  }));
}

// ---------------------------------------------------------------------------
// Apple (backup directory; no key needed)
// ---------------------------------------------------------------------------

async function searchApple(name) {
  const data = await getJson(
    `${APPLE_API}/search?media=podcast&entity=podcast&limit=${HOW_MANY_RESULTS}&term=${encodeURIComponent(name)}`
  );
  return (data.results || [])
    .filter((p) => p.feedUrl) // without a feed address we can't use it
    .map((p) => ({
      source: "apple",
      id: p.collectionId,
      title: p.collectionName || "(no title)",
      author: p.artistName || "",
      image: p.artworkUrl600 || p.artworkUrl100 || "",
      feedUrl: p.feedUrl,
      description: "", // Apple's search doesn't include a description
    }));
}

async function appleEpisodes(podcast) {
  const data = await getJson(
    `${APPLE_API}/lookup?id=${podcast.id}&entity=podcastEpisode&limit=${HOW_MANY_EPISODES}`
  );
  // Apple's answer starts with the podcast itself, followed by its episodes.
  // We keep only the episodes.
  return (data.results || [])
    .filter((r) => r.wrapperType === "podcastEpisode")
    .map((e) => ({
      title: e.trackName || "(no title)",
      date: e.releaseDate ? new Date(e.releaseDate) : null,
      duration: Math.round((e.trackTimeMillis || 0) / 1000),
      audioUrl: e.episodeUrl,
      description: e.description || "",
    }));
}

// ---------------------------------------------------------------------------
// RSS: reading the podcast's own feed directly (backup plan)
// ---------------------------------------------------------------------------
// This is what the directories do behind the scenes. We can only do it ourselves
// when the podcast's server allows web apps to read the feed (some do, some don't).

// Turns "1:02:03", "62:03" or "3723" into seconds.
function parseDuration(text) {
  if (!text) return 0;
  return text
    .trim()
    .split(":")
    .reduce((total, part) => total * 60 + (Number(part) || 0), 0);
}

async function rssEpisodes(podcast) {
  let response;
  try {
    response = await fetch(podcast.feedUrl);
  } catch {
    throw new Error("the podcast's server doesn't let web apps read its feed directly");
  }
  if (!response.ok) throw new Error(`the feed answered with error ${response.status}`);

  // An RSS feed is text in a format called XML. The browser can take it apart for us.
  const xml = new DOMParser().parseFromString(await response.text(), "text/xml");

  // In RSS, every episode is an <item>. Inside it: <title>, <pubDate>,
  // <itunes:duration>, and <enclosure url="..."> which points to the audio file.
  return [...xml.getElementsByTagName("item")]
    .slice(0, HOW_MANY_EPISODES)
    .map((item) => {
      const read = (tag) => item.getElementsByTagName(tag)[0]?.textContent.trim() || "";
      const enclosure = item.getElementsByTagName("enclosure")[0];
      return {
        title: read("title") || "(no title)",
        date: read("pubDate") ? new Date(read("pubDate")) : null,
        duration: parseDuration(read("itunes:duration")),
        audioUrl: enclosure ? enclosure.getAttribute("url") : "",
        description: read("description"),
      };
    })
    .filter((e) => e.audioUrl);
}

// ---------------------------------------------------------------------------
// Spotting duplicates
// ---------------------------------------------------------------------------
// fyyd and Apple often know the same podcast. We compare feed addresses
// (ignoring small differences like "https://" or "www.") and title + author.

function feedKey(url) {
  return (url || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

function nameKey(podcast) {
  return `${podcast.title}|${podcast.author}`.toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// The two functions the rest of the app uses
// ---------------------------------------------------------------------------

// 1) Search both directories at the same time.
//    Returns { fyyd: [...], apple: [...], errors: [...] }.
//    Apple's list has the podcasts that fyyd already found removed.
async function searchPodcasts(name) {
  // allSettled = wait for both, even if one of them fails.
  const [fyyd, apple] = await Promise.allSettled([searchFyyd(name), searchApple(name)]);
  const errors = [];

  const fyydList = fyyd.status === "fulfilled" ? fyyd.value : [];
  if (fyyd.status === "rejected") errors.push(`fyyd: ${fyyd.reason.message}`);

  let appleList = apple.status === "fulfilled" ? apple.value : [];
  if (apple.status === "rejected") errors.push(`Apple: ${apple.reason.message}`);

  const seenFeeds = new Set(fyydList.map((p) => feedKey(p.feedUrl)));
  const seenNames = new Set(fyydList.map(nameKey));
  appleList = appleList.filter(
    (p) => !seenFeeds.has(feedKey(p.feedUrl)) && !seenNames.has(nameKey(p))
  );

  return { fyyd: fyydList, apple: appleList, errors };
}

// 2) Get a podcast's episodes, newest first.
//    First ask the directory that found the podcast. If that fails or returns
//    nothing, try reading the podcast's feed directly.
async function getEpisodes(podcast) {
  let episodes = [];
  try {
    episodes =
      podcast.source === "fyyd" ? await fyydEpisodes(podcast) : await appleEpisodes(podcast);
  } catch (error) {
    console.warn("Directory episodes failed, trying the feed directly:", error);
  }
  if (!episodes.length) {
    episodes = await rssEpisodes(podcast);
  }
  // Newest first. Episodes without a date go to the end.
  return episodes.sort((a, b) => (b.date || 0) - (a.date || 0));
}
