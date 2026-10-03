// notes.js: voice notes.
//
// The microphone button opens a note box and starts listening. Chrome's speech
// recognition turns what you say into text (for that, Chrome usually sends your voice
// to Google's servers). You can correct the text, then save.
// Notes are kept on your phone (see storage.js) and listed on the Notes tab.
// Each note remembers which episode you were listening to, and where.

const NOTE_LANGUAGE = "en-US"; // the language you speak your notes in

// The browser's speech recognition. Stays empty if this browser doesn't have one.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let noteContext = null; // what was playing when the note was started: { podcast, episode, position }
let editingNoteId = null; // set while editing an existing note
let resumeAfterNote = false; // was the podcast playing? then continue it afterwards
let recognition = null; // the speech recognition that's running right now, if any
let textBeforeListening = ""; // what was already in the box when listening started
let skipNextPopstate = false; // see handleNotePopstate()

function isNoteSheetOpen() {
  return !$("noteSheet").hidden;
}

// ===========================================================================
// The note box
// ===========================================================================

// Open the box. Without a note: start a new one and listen right away.
// With a note: edit its text.
function openNoteSheet(note = null) {
  if (isNoteSheetOpen()) return;
  editingNoteId = note ? note.id : null;

  if (note) {
    resumeAfterNote = false;
    $("noteTitle").textContent = "Edit note";
    $("noteContext").textContent = describeContext(note);
  } else {
    // Pause the podcast while you speak, and remember the episode and the moment.
    resumeAfterNote = !audio.paused;
    if (resumeAfterNote) audio.pause();
    noteContext = nowPlaying
      ? {
          podcast: nowPlaying.podcast,
          episode: nowPlaying.episode,
          position: Math.floor(startAt !== null ? startAt : audio.currentTime),
        }
      : null;
    $("noteTitle").textContent = "New note";
    $("noteContext").textContent = describeContext(noteContext);
  }
  $("noteContext").hidden = !$("noteContext").textContent;
  $("noteText").value = note ? note.text : "";
  setNoteStatus("");
  $("noteSheet").hidden = false;

  // Add a history note, so Android's back gesture closes the box instead of leaving the screen.
  history.pushState({ ...history.state, sheet: true }, "");

  if (!note) startListening();
}

// Close the box. save = true keeps the text; false throws it away.
// fromBackGesture = true when the browser already went back in history itself.
function closeNoteSheet(save, fromBackGesture = false) {
  if (!isNoteSheetOpen()) return;
  stopListening(true);

  const text = $("noteText").value.trim();
  if (save && text) {
    if (editingNoteId) updateNote(editingNoteId, text);
    else addNote(text, noteContext);
    showToast(editingNoteId ? "Note updated" : "Note saved");
  }

  $("noteText").blur(); // hides the keyboard
  $("noteSheet").hidden = true;
  if (!fromBackGesture) {
    skipNextPopstate = true;
    history.back(); // remove the history note we added when opening
  }

  if (resumeAfterNote) audio.play().catch(showPlayerProblem);
  resumeAfterNote = false;
  editingNoteId = null;
  if (!$("notesScreen").hidden) drawNotes();
}

// Called by app.js when "back" happens. Returns true if the note box dealt with it.
function handleNotePopstate() {
  if (skipNextPopstate) {
    skipNextPopstate = false; // this "back" was us closing the box; nothing else to do
    return true;
  }
  if (isNoteSheetOpen()) {
    closeNoteSheet(false, true); // back gesture = cancel
    return true;
  }
  return false;
}

function setNoteStatus(message) {
  $("noteStatus").textContent = message;
}

// "History Hour · Episode 12 · at 4:31"
function describeContext(context) {
  if (!context || !context.episode) return "";
  return `${context.podcast.title} · ${context.episode.title} · at ${formatTime(context.position)}`;
}

$("noteButton").addEventListener("click", () => openNoteSheet());
$("noteSaveButton").addEventListener("click", () => closeNoteSheet(true));
$("noteCancelButton").addEventListener("click", () => closeNoteSheet(false));

// ===========================================================================
// Speech recognition
// ===========================================================================

const SPEECH_PROBLEMS = {
  "not-allowed": "The microphone isn't allowed. Allow it for this app in Chrome's site settings, or type your note.",
  "service-not-allowed": "Speech recognition is switched off on this phone. You can type your note.",
  "no-speech": "I didn't hear anything. Tap the microphone to try again.",
  "audio-capture": "No microphone found. You can type your note.",
  network: "Speech recognition needs an internet connection. You can type your note.",
};

function startListening() {
  if (!Recognition) {
    setNoteStatus("Speech recognition isn't available here. Type your note, or use the microphone key on your keyboard.");
    return;
  }
  stopListening(true);

  const listener = new Recognition();
  listener.lang = NOTE_LANGUAGE;
  listener.interimResults = true; // show words while you're still speaking
  listener.continuous = false; // stops by itself when you pause (most reliable on Android)
  textBeforeListening = $("noteText").value.trim();
  let problem = "";

  listener.onstart = () => {
    setNoteStatus("Listening…");
    $("noteMicButton").classList.add("listening");
  };

  // Called again and again while you speak, each time with a better guess of the text.
  listener.onresult = (event) => {
    let spoken = "";
    for (const result of event.results) spoken += result[0].transcript;
    $("noteText").value = [textBeforeListening, spoken.trim()].filter(Boolean).join(" ");
  };

  listener.onerror = (event) => {
    if (event.error === "aborted") return; // we stopped it ourselves
    problem = SPEECH_PROBLEMS[event.error] || `Speech recognition problem (${event.error}). You can type your note.`;
  };

  listener.onend = () => {
    if (recognition === listener) recognition = null;
    $("noteMicButton").classList.remove("listening");
    setNoteStatus(problem || "Tap the microphone to add more, or Save.");
  };

  recognition = listener;
  try {
    listener.start();
  } catch {
    recognition = null;
    setNoteStatus("Couldn't start listening. You can type your note.");
  }
}

// quietly = true: stop without touching the status line or the text any more.
function stopListening(quietly = false) {
  if (!recognition) return;
  const listener = recognition;
  recognition = null;
  if (quietly) {
    listener.onresult = listener.onerror = listener.onend = listener.onstart = null;
    $("noteMicButton").classList.remove("listening");
    try {
      listener.abort();
    } catch {
      // already stopped
    }
  } else {
    listener.stop(); // finishes the current sentence, then "onend" runs
  }
}

// The microphone button inside the box: start or stop listening.
$("noteMicButton").addEventListener("click", () => {
  if (recognition) stopListening();
  else startListening();
});

// ===========================================================================
// The Notes tab
// ===========================================================================

function drawNotes() {
  const notes = getNotes();
  $("notesList").replaceChildren(...notes.map(noteCard));
  $("notesEmpty").hidden = notes.length > 0;
  $("shareAllButton").hidden = notes.length === 0;
}

// A note as plain text, for sharing.
function noteAsText(note) {
  const when = new Date(note.createdAt);
  const where = describeContext(note);
  return `${note.text}\n(${formatDate(when)} ${formatClock(when)}${where ? ` · ${where}` : ""})`;
}

// Hand text to another app (email, Keep, a messenger...). If the phone can't
// share, copy it instead.
async function shareText(text) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
    } catch {
      // you closed the share menu; nothing to do
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied");
  } catch {
    showToast("Couldn't share or copy");
  }
}

// One note in the list.
function noteCard(note) {
  const card = el("div", "note");
  const when = new Date(note.createdAt);
  card.append(el("p", "note-text", note.text));
  card.append(el("div", "note-meta", `${formatDate(when)} ${formatClock(when)}`));

  // Where you were: tap to hear that moment again.
  if (note.episode) {
    const jump = el("button", "note-jump");
    jump.type = "button";
    jump.append(el("span", "note-jump-time", `Play from ${formatTime(note.position)}`));
    jump.append(el("span", "note-jump-title", `${note.podcast.title} · ${note.episode.title}`));
    jump.addEventListener("click", () => playEpisodeAt(note.episode, note.podcast, note.position));
    card.append(jump);
  }

  const actions = el("div", "note-actions");
  const editButton = el("button", "text-button", "Edit");
  editButton.addEventListener("click", () => openNoteSheet(note));
  const shareButton = el("button", "text-button", "Share");
  shareButton.addEventListener("click", () => shareText(noteAsText(note)));

  // Delete needs two taps, so a slip of the finger can't lose a note.
  const deleteButton = el("button", "text-button", "Delete");
  deleteButton.addEventListener("click", () => {
    if (deleteButton.classList.contains("danger")) {
      deleteNote(note.id);
      drawNotes();
      showToast("Note deleted");
      return;
    }
    deleteButton.classList.add("danger");
    deleteButton.textContent = "Tap again to delete";
    setTimeout(() => {
      deleteButton.classList.remove("danger");
      deleteButton.textContent = "Delete";
    }, 3000);
  });

  actions.append(editButton, shareButton, deleteButton);
  card.append(actions);
  return card;
}

$("shareAllButton").addEventListener("click", () => {
  shareText(getNotes().map(noteAsText).join("\n\n"));
});
