let popupMode = null;
let lastPress = 0;
let eventData = null;
let chanceData = null;
let responses = {};
let countdownTimer = null;
let splitserData = null;

const COOLDOWN_MS = 5000;
const SYNC_URL = "https://ho-krat-trigger.lucdegoeij.workers.dev/?key=aksjjkhdsadk2387or4ihfakhufahiueciahlcvhliarg9loahe3qtfh4789";
const POLL_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 3000;

async function init() {
  await loadResponses();
  await loadEventData();
  await loadSplitserData();
}

async function triggerDataSync() {
  try {
    document.getElementById("splitserStatus").textContent =
      "Splitser-sync gestart...";
    document.getElementById("splitserStatus").style.color = "#ffcc00";

    const oldSplitserUpdatedAt = splitserData?.updatedAt;

    const response = await fetch(SYNC_URL, {
      cache: "no-store"
    });

    console.log("SYNC STATUS", response.status);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    pollSplitserUpdate(oldSplitserUpdatedAt);

  } catch (e) {
    console.error("SYNC ERROR:", e);

    document.getElementById("splitserStatus").textContent =
      "Splitser-sync mislukt.";
    document.getElementById("splitserStatus").style.color = "#ff5c5c";
  }
}

async function pollSplitserUpdate(oldUpdatedAt) {
  const startTime = Date.now();

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const response = await fetch(
  "https://ho-krat-trigger.lucdegoeij.workers.dev/splitser-balance?key=aksjjkhdsadk2387or4ihfakhufahiueciahlcvhliarg9loahe3qtfh4789",
  { cache: "no-store" }
);
      if (!response.ok) continue;

      const freshData = await response.json();

      if (freshData.updatedAt && freshData.updatedAt !== oldUpdatedAt) {
        splitserData = freshData;
        renderSplitserStatus(splitserData);
        return;
      }
    } catch {
      console.log("Splitser polling retry");
    }
  }

  renderSplitserStatus(splitserData);
}

async function loadResponses() {
  try {
    const response = await fetch("responses.json?cache=" + Date.now());
    if (!response.ok) throw new Error("responses.json niet gevonden");
    responses = await response.json();
  } catch {
    responses = {
      cooldown: ["Rustig. De Spiritueel Leider denkt na."],
      noSpond: ["Spond is nog niet ingeladen."],
      yes: ["Tijd voor een HO krat."],
      maybe: ["Eerst even peilen."],
      no: ["Vandaag nog even niet."],
      secondCrateYes: ["Tijd voor een tweede HO krat."],
      secondCrateNo: ["Dan wordt het dus een gecontroleerde dorst."]
    };
  }
}

async function loadEventData() {
  try {
    const response = await fetch("upcoming-event.json?cache=" + Date.now());
    if (!response.ok) throw new Error("JSON niet gevonden");

    eventData = await response.json();
    chanceData = calculateChances(eventData);

    renderEvent(eventData, chanceData);
    document.getElementById("spondStatus").textContent = "Spond-data ingeladen.";
    startCountdown();
  } catch {
    document.getElementById("spondStatus").textContent = "Spond-data niet gevonden.";
  }
}

async function loadSplitserData() {
  try {
    const response = await fetch("splitser-overzicht.json?cache=" + Date.now());
    if (!response.ok) throw new Error("splitser-overzicht.json niet gevonden");

    splitserData = await response.json();
    renderSplitserStatus(splitserData);
  } catch {
    document.getElementById("splitserStatus").textContent =
      "Splitser-data niet gevonden.";
  }
}

function renderSplitserStatus(data) {
  const el = document.getElementById("splitserStatus");
  if (!el || !data?.updatedAt) return;

  const ageMs = Date.now() - new Date(data.updatedAt).getTime();
  const ageMin = Math.floor(ageMs / 60000);

  let label = `Laatste Splitser-sync: ${ageMin} min geleden`;

  if (ageMin < 1) {
    label = "Laatste Splitser-sync: zojuist";
  }

  el.textContent = label;

  if (ageMin <= 15) {
    el.style.color = "#46d369";
  } else if (ageMin <= 60) {
    el.style.color = "#ffcc00";
  } else {
    el.style.color = "#ff5c5c";
  }
}

function calculateChances(data) {
  const event = data.upcomingEvent || {};
  const counts = event.counts || {};

  const attending = counts.attending || 0;
  const declined = counts.declined || 0;
  const unanswered = counts.unanswered || 0;
  const type = (event.type || "").toLowerCase();
  const seed = stableRandom(event.id || event.startTimestamp || "ho-krat");

  let typeBonus = 0;
  if (type.includes("training")) typeBonus = 12;
  if (type.includes("match") || type.includes("wedstrijd")) typeBonus = 22;
  if (type.includes("td") || type.includes("party") || type.includes("feest")) typeBonus = 35;

  let secondCrate;

  if (attending <= 1) {
    secondCrate = 0;
  } else if (attending <= 12) {
    secondCrate = 95 * Math.pow((attending - 1) / 11, 2);
  } else {
    secondCrate = 95 + 4 * (1 - Math.exp(-(attending - 12) / 6));
  }

  secondCrate = Math.min(99, Math.round(secondCrate));

  const escalation = clamp(
    attending * 4.7 + unanswered * 3.2 - declined * 1.4 + typeBonus + seed * 24,
    5,
    99
  );

  return {
    secondCrate,
    escalation: Math.round(escalation)
  };
}

function renderEvent(data, chances) {
  const event = data.upcomingEvent || {};
  const counts = event.counts || {};
  const start = new Date(event.startTimestamp);
  const end = new Date(event.endTimestamp);

  document.getElementById("eventCard").style.display = "block";
  document.getElementById("eventTitle").textContent =
    `${event.name || "Onbekend event"} - ${data.team || "HO"}`;

  document.getElementById("eventMeta").innerHTML = `
    ${formatDate(start)} · ${formatTime(start)}-${formatTime(end)}
    <br>
    Locatie: ${event.location || "Nog geen locatie"}
    <br>
    Laatst bijgewerkt: ${formatDateTime(new Date(data.updatedAt))}
  `;

  document.getElementById("attendingCount").textContent = counts.attending ?? "-";
  document.getElementById("declinedCount").textContent = counts.declined ?? "-";
  document.getElementById("unansweredCount").textContent = counts.unanswered ?? "-";

  setChance("second", chances.secondCrate);
  setChance("escalation", chances.escalation);

  document.getElementById("attendingNames").textContent = listNames(event.attending);
  document.getElementById("declinedNames").textContent = listNames(event.declined);
  document.getElementById("unansweredNames").textContent = listNames(event.unanswered);
}

async function checkHoKrat() {
  const now = Date.now();

  if (now - lastPress < COOLDOWN_MS) {
    lastPress = now;
    setResult("NEE.", randomFrom(responses.cooldown));
    return;
  }

  lastPress = now;

  setResult("...", "Het Orakel raadpleegt Spond en Splitser.");

  triggerDataSync();

  if (!eventData || !eventData.upcomingEvent) {
    setResult("NEE.", randomFrom(responses.noSpond));
    return;
  }

  const decision = getDecision();

  if (!decision.allowed) {
    setResult("NEE.", decision.reason);
    return;
  }

  openPopup(decision.mode, "HEB JE AL EEN KRAT GEHAALD DAN?");
}

function getDecision() {
  const event = eventData.upcomingEvent || {};
  const type = (event.type || "").toLowerCase();
  const attending = event.counts?.attending || 0;

  const eventDate = new Date(event.startTimestamp);
  const now = new Date();

  const isToday =
    eventDate.getFullYear() === now.getFullYear() &&
    eventDate.getMonth() === now.getMonth() &&
    eventDate.getDate() === now.getDate();

  if (!isToday) {
    return {
      allowed: false,
      reason: "Vandaag is er geen training of wedstrijd."
    };
  }

  const isTraining = type.includes("training");
  const isMatch = type.includes("match") || type.includes("wedstrijd");

  if (!isTraining && !isMatch) {
    return {
      allowed: false,
      reason: "Dit event is geen training of wedstrijd."
    };
  }

  const minutes = now.getHours() * 60 + now.getMinutes();

  if (isMatch) {
    if (minutes < 8 * 60) {
      return {
        allowed: false,
        reason: "Wedstrijd-HO mag pas vanaf 08:00."
      };
    }

    return {
      allowed: true,
      mode: "firstCrateOnly"
    };
  }

  if (isTraining) {
    if (minutes < 19 * 60 + 15) {
      return {
        allowed: false,
        reason: "Training-HO mag pas vanaf 19:15."
      };
    }

    if (attending >= 12) {
      return {
        allowed: true,
        mode: "trainingTwoCratesPossible"
      };
    }

    return {
      allowed: true,
      mode: "firstCrateOnly"
    };
  }

  return {
    allowed: false,
    reason: "Het Orakel snapt dit event niet."
  };
}

function popupYes() {
  if (popupMode === "firstCrateOnly") {
    closePopup();
    setResult("NEE.", "Dan is het kratwerk al gedaan.");
    return;
  }

  if (popupMode === "trainingTwoCratesPossible") {
    openPopup("secondCrateCheck", "HEB JE OOK EEN 2E KRAT GEHAALD?");
    return;
  }

  if (popupMode === "secondCrateCheck") {
    closePopup();
    setResult("NEE.", "Twee kratten is genoeg. Gedraag je.");
  }
}

function popupNo() {
  if (popupMode === "firstCrateOnly") {
    closePopup();
    setResult("JA MAN.", randomFrom(responses.yes));
    vibratePositive();
    return;
  }

  if (popupMode === "trainingTwoCratesPossible") {
    closePopup();
    setResult("JA MAN.", randomFrom(responses.yes));
    vibratePositive();
    return;
  }

  if (popupMode === "secondCrateCheck") {
    closePopup();
    setResult("JA MAN.", randomFrom(responses.secondCrateYes));
    vibratePositive();
  }
}

function setChance(id, value) {
  document.getElementById(id + "Chance").textContent = value + "%";
  document.getElementById(id + "Bar").style.width = value + "%";
}

function startCountdown() {
  updateCountdown();

  if (countdownTimer) {
    clearInterval(countdownTimer);
  }

  countdownTimer = setInterval(updateCountdown, 1000);
}

function updateCountdown() {
  if (!eventData || !eventData.upcomingEvent) return;

  const start = new Date(eventData.upcomingEvent.startTimestamp).getTime();
  const diff = start - Date.now();

  if (diff <= 0) {
    document.getElementById("countdown").textContent = "NU.";
    return;
  }

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff / 3600000) % 24);
  const minutes = Math.floor((diff / 60000) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  document.getElementById("countdown").textContent =
    days > 0
      ? `${days}d ${hours}u ${minutes}m`
      : `${hours}u ${minutes}m ${seconds}s`;
}

function stableRandom(text) {
  let hash = 0;

  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash % 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomFrom(list) {
  if (!list || !list.length) return "";
  return list[Math.floor(Math.random() * list.length)];
}

function setResult(answer, sub) {
  document.getElementById("answer").textContent = answer;
  document.getElementById("sub").textContent = sub;
}

function openPopup(mode, title) {
  popupMode = mode;
  document.getElementById("popup-title").textContent = title;
  document.getElementById("popup").style.display = "flex";
}

function closePopup() {
  document.getElementById("popup").style.display = "none";
  popupMode = null;
}

function vibratePositive() {
  if (navigator.vibrate) {
    navigator.vibrate([80, 60, 120]);
  }
}

function listNames(names) {
  if (!names || !names.length) return "-";
  return names.join(", ");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatDate(date) {
  return date.toLocaleDateString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "short"
  });
}

function formatTime(date) {
  return date.toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateTime(date) {
  return date.toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

init();
