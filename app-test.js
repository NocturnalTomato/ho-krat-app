let popupMode = null;
let lastPress = 0;
let eventData = null;
let chanceData = null;
let responses = {};
let countdownTimer = null;
let splitserData = null;
let splitserFullOpen = false;
let kratflapCheckCount = 0;
let kratflapUnlocked = false;

const COOLDOWN_MS = 5000;
const SYNC_URL = "https://ho-krat-trigger.lucdegoeij.workers.dev/?key=aksjjkhdsadk2387or4ihfakhufahiueciahlcvhliarg9loahe3qtfh4789";
const SPLITSER_URL = "https://ho-krat-trigger.lucdegoeij.workers.dev/splitser-balance?key=aksjjkhdsadk2387or4ihfakhufahiueciahlcvhliarg9loahe3qtfh4789";
const SPOND_URL = "https://ho-krat-spond-d1-test.lucdegoeij.workers.dev/";
const POLL_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 3000;
const KRATFLAP_UNLOCK_KEY = "hokrat_kratflap_unlocked";

async function init() {
  restoreKratflapUnlock();
  showSplitserLoading();
  await loadResponses();

  loadEventData();
  loadSplitserData();
}

/* =========================
   SPLITSER
========================= */

function showSplitserLoading() {
  const card = document.getElementById("splitserCard");
  const heroesEl = document.getElementById("splitserHeroes");
  const klaplopersEl = document.getElementById("splitserKlaplopers");
  const fullListEl = document.getElementById("splitserFullList");

  if (card) card.style.display = "block";

  if (heroesEl) {
    heroesEl.innerHTML = `
      <li>
        <div class="compact-person-row">
          <span class="rank-name">Laden...</span>
          <span class="rank-amount">Splitser wordt ondervraagd</span>
        </div>
      </li>
    `;
  }

  if (klaplopersEl) klaplopersEl.innerHTML = "";
  if (fullListEl) fullListEl.innerHTML = "";
}

async function triggerDataSync() {
  try {
    showSplitserLoading();

    const status = document.getElementById("splitserStatus");
    if (status) {
      status.textContent = "Splitser-sync gestart...";
      status.style.color = "#ffcc00";
    }

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

    const status = document.getElementById("splitserStatus");
    if (status) {
      status.textContent = "Splitser-sync mislukt.";
      status.style.color = "#ff5c5c";
    }

    showSplitserError("Sync mislukt");
  }
}

async function pollSplitserUpdate(oldUpdatedAt) {
  const startTime = Date.now();

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const response = await fetch(SPLITSER_URL, {
        cache: "no-store"
      });

      if (!response.ok) continue;

      const freshData = await response.json();

      if (freshData.updatedAt && freshData.updatedAt !== oldUpdatedAt) {
        splitserData = freshData;
        renderSplitserStatus(splitserData);
        return;
      }
    } catch (err) {
      console.log("Splitser polling retry", err);
    }
  }

  renderSplitserStatus(splitserData);
}

async function loadSplitserData() {
  showSplitserLoading();

  try {
    const response = await fetch(SPLITSER_URL, {
      cache: "no-store"
    });

    console.log("SPLITSER HTTP", response.status);

    if (!response.ok) {
      throw new Error(`Worker gaf HTTP ${response.status}`);
    }

    splitserData = await response.json();
    console.log("SPLITSER DATA", splitserData);

    renderSplitserStatus(splitserData);
  } catch (err) {
    console.error("SPLITSER LOAD ERROR:", err);

    const status = document.getElementById("splitserStatus");
    if (status) {
      status.textContent = "Splitser-data niet bereikbaar.";
      status.style.color = "#ff5c5c";
    }

    showSplitserError("Splitser niet bereikbaar");
  }
}

function showSplitserError(message) {
  const card = document.getElementById("splitserCard");
  const heroesEl = document.getElementById("splitserHeroes");
  const klaplopersEl = document.getElementById("splitserKlaplopers");
  const fullListEl = document.getElementById("splitserFullList");

  if (card) card.style.display = "block";

  if (heroesEl) {
    heroesEl.innerHTML = `
      <li>
        <div class="compact-person-row">
          <span class="rank-name">${message}</span>
          <span class="rank-amount amount-minus">Check de Worker of console</span>
        </div>
      </li>
    `;
  }

  if (klaplopersEl) klaplopersEl.innerHTML = "";
  if (fullListEl) fullListEl.innerHTML = "";
}

function renderSplitserStatus(data) {
  const el = document.getElementById("splitserStatus");

  if (!data?.updatedAt) {
    if (el) {
      el.textContent = "Splitser-data geladen zonder update-tijd.";
      el.style.color = "#ffcc00";
    }

    renderSplitserCard(data);
    return;
  }

  const ageMs = Date.now() - new Date(data.updatedAt).getTime();
  const ageMin = Math.floor(ageMs / 60000);

  let label = `Splitser-sync: ${ageMin} min geleden`;

  if (ageMin < 1) {
    label = "Splitser-sync: zojuist";
  }

  if (el) {
    el.textContent = label;

    if (ageMin <= 15) {
      el.style.color = "#46d369";
    } else if (ageMin <= 60) {
      el.style.color = "#ffcc00";
    } else {
      el.style.color = "#ff5c5c";
    }
  }

  renderSplitserCard(data);
}

function renderSplitserCard(data) {
  const card = document.getElementById("splitserCard");
  const heroesEl = document.getElementById("splitserHeroes");
  const klaplopersEl = document.getElementById("splitserKlaplopers");
  const fullListEl = document.getElementById("splitserFullList");

  if (!card || !heroesEl || !klaplopersEl || !fullListEl) {
    console.error("Splitser HTML-elementen missen.");
    return;
  }

  card.style.display = "block";

  const members = Array.isArray(data?.people)
    ? data.people.filter(member => Number.isFinite(member.amountCents))
    : [];

  if (!members.length) {
    showSplitserError("Geen leden gevonden");
    return;
  }

  const sortedHigh = [...members].sort((a, b) => b.amountCents - a.amountCents);
  const sortedLow = [...members].sort((a, b) => a.amountCents - b.amountCents);

  const top3High = sortedHigh.slice(0, 3);
  const top3Low = sortedLow.slice(0, 3);

  heroesEl.innerHTML = "";
  top3High.forEach(member => {
    heroesEl.appendChild(createCompactPersonItem(member));
  });

  klaplopersEl.innerHTML = "";
  top3Low.forEach(member => {
    klaplopersEl.appendChild(createCompactPersonItem(member));
  });

  fullListEl.innerHTML = "";

  const maxPlus = Math.max(...members.map(member => member.amountCents), 1);
  const maxMin = Math.abs(Math.min(...members.map(member => member.amountCents), -1));

  sortedHigh.forEach(member => {
    fullListEl.appendChild(createFullBalanceItem(member, maxPlus, maxMin));
  });
}

function createCompactPersonItem(member) {
  const li = document.createElement("li");

  const row = document.createElement("div");
  row.className = "compact-person-row";

  const name = document.createElement("span");
  name.className = "rank-name";
  name.textContent = member.name;

  const amount = document.createElement("span");
  amount.className = member.amountCents >= 0
    ? "rank-amount amount-plus"
    : "rank-amount amount-minus";
  amount.textContent = formatDutchAmount(member.amountCents);

  row.appendChild(name);
  row.appendChild(amount);
  li.appendChild(row);

  return li;
}

function createFullBalanceItem(member, maxPlus, maxMin) {
  const row = document.createElement("div");
  row.className = "balance-row";

  const top = document.createElement("div");
  top.className = "balance-row-top";

  const name = document.createElement("span");
  name.className = "balance-name";
  name.textContent = member.name;

  const amount = document.createElement("span");
  amount.className = member.amountCents >= 0
    ? "balance-amount amount-plus"
    : "balance-amount amount-minus";
  amount.textContent = formatDutchAmount(member.amountCents);

  top.appendChild(name);
  top.appendChild(amount);

  const bar = document.createElement("div");
  bar.className = "balance-bar";

  const plusHalf = document.createElement("div");
  plusHalf.className = "balance-half balance-plus-half";

  const minHalf = document.createElement("div");
  minHalf.className = "balance-half balance-min-half";

  const plusFill = document.createElement("div");
  plusFill.className = "balance-fill balance-plus-fill";

  const minFill = document.createElement("div");
  minFill.className = "balance-fill balance-min-fill";

  if (member.amountCents > 0) {
    const width = Math.min(100, Math.round((member.amountCents / maxPlus) * 100));
    plusFill.style.width = `${width}%`;
  }

  if (member.amountCents < 0) {
    const width = Math.min(100, Math.round((Math.abs(member.amountCents) / maxMin) * 100));
    minFill.style.width = `${width}%`;
  }

  plusHalf.appendChild(plusFill);
  minHalf.appendChild(minFill);

  bar.appendChild(plusHalf);
  bar.appendChild(minHalf);

  row.appendChild(top);
  row.appendChild(bar);

  return row;
}

function toggleSplitserFull() {
  const wrap = document.getElementById("splitserFullWrap");
  const button = document.getElementById("splitserToggle");

  if (!wrap || !button) return;

  splitserFullOpen = !splitserFullOpen;
  wrap.style.display = splitserFullOpen ? "block" : "none";
  button.textContent = splitserFullOpen
    ? "Verberg volledige balans"
    : "Toon volledige balans";
}

function formatDutchAmount(amountCents) {
  return (amountCents / 100).toLocaleString("nl-NL", {
    style: "currency",
    currency: "EUR"
  });
}

/* =========================
   RESPONSES + SPOND
========================= */

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
    const response = await fetch(SPOND_URL + "?cache=" + Date.now(), {
      cache: "no-store"
    });

    if (!response.ok) throw new Error("JSON niet gevonden");

    eventData = await response.json();
    chanceData = calculateChances(eventData);

    renderEvent(eventData, chanceData);

    const spondStatus = document.getElementById("spondStatus");
    if (spondStatus) {
      spondStatus.textContent = "Spond-data live ingeladen.";
      spondStatus.style.color = "#46d369";
    }

    startCountdown();
  } catch (err) {
    console.error("SPOND LOAD ERROR:", err);

    const spondStatus = document.getElementById("spondStatus");
    if (spondStatus) {
      spondStatus.textContent = "Spond-data niet gevonden.";
      spondStatus.style.color = "#ff5c5c";
    }
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
  const primaryEvent = data.currentEvent || data.upcomingEvent || null;

  const secondaryEvent =
    data.nextEvent && primaryEvent && data.nextEvent.id !== primaryEvent.id
      ? data.nextEvent
      : null;

  renderPrimaryEventCard(data, primaryEvent, chances);
  renderNextEventCard(data, secondaryEvent);
}





/* =========================
   HO KRAT BUTTON
========================= */

async function checkHoKrat() {
  registerKratflapCheck();

  const now = Date.now();

  if (now - lastPress < COOLDOWN_MS) {
    lastPress = now;
    setResult("NEE.", randomFrom(responses.cooldown));
    return;
  }

  lastPress = now;

  setResult("...", "Het Orakel raadpleegt Spond en Splitser.");

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

/* =========================
   KRATFLAP GAME
========================= */

function restoreKratflapUnlock() {
  kratflapUnlocked = localStorage.getItem(KRATFLAP_UNLOCK_KEY) === "1";

  if (kratflapUnlocked) {
    showKratflapTeaser();
  }
}

function registerKratflapCheck() {
  if (kratflapUnlocked) return;

  kratflapCheckCount += 1;

  if (kratflapCheckCount >= 5) {
    kratflapUnlocked = true;
    localStorage.setItem(KRATFLAP_UNLOCK_KEY, "1");
    showKratflapTeaser();
  }
}

function showKratflapTeaser() {
  const teaser = document.getElementById("kratflapTeaser");
  if (!teaser) return;

  teaser.style.display = "block";
}

function openKratflap() {
  const sheet = document.getElementById("kratflapSheet");
  if (!sheet) return;

  sheet.classList.add("show");
  sheet.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeKratflap() {
  const sheet = document.getElementById("kratflapSheet");
  if (!sheet) return;

  sheet.classList.remove("show");
  sheet.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

/* =========================
   HELPERS
========================= */

function renderPrimaryEventCard(data, event, chances) {
  const card = document.getElementById("eventCard");

  if (!card) return;

  if (!event) {
    card.style.display = "none";
    return;
  }

  const counts = event.counts || {};
  const start = new Date(event.startTimestamp);
  const end = event.endTimestamp ? new Date(event.endTimestamp) : null;

  card.style.display = "block";

  setText("eventTitle", `${event.name || "Onbekend event"} - ${data.team || "HO"}`);

  setHtml("eventMeta", `
    ${formatDate(start)} · ${formatTime(start)}${end ? "-" + formatTime(end) : ""}
    <br>
    Locatie: ${event.location || "Nog geen locatie"}
    <br>
    Laatst bijgewerkt: ${formatDateTime(new Date(data.updatedAt))}
  `);

  setText("countdown", formatCountdown(start));

  setText("attendingCount", counts.attending ?? "-");
  setText("declinedCount", counts.declined ?? "-");
  setText("unansweredCount", counts.unanswered ?? "-");

  if (chances) {
    setChance("second", chances.secondCrate);
    setChance("escalation", chances.escalation);
  }

  setText("attendingNames", listNames(event.attending));
  setText("declinedNames", listNames(event.declined));
  setText("unansweredNames", listNames(event.unanswered));
  setText("lastMinuteDeclinedNames", listLastMinuteDeclined(event.lastMinuteDeclined));
}

function renderNextEventCard(data, event) {
  const card = document.getElementById("nextEventCard");

  if (!card) return;

  if (!event) {
    card.style.display = "none";
    return;
  }

  const counts = event.counts || {};
  const start = new Date(event.startTimestamp);
  const end = event.endTimestamp ? new Date(event.endTimestamp) : null;

  card.style.display = "block";

  setText("nextEventTitle", `${event.name || "Onbekend event"} - ${data.team || "HO"}`);

  setHtml("nextEventMeta", `
    ${formatDate(start)} · ${formatTime(start)}${end ? "-" + formatTime(end) : ""}
    <br>
    Locatie: ${event.location || "Nog geen locatie"}
  `);

  setText("nextEventCountdown", formatCountdown(start));

  setText("nextAttendingCount", counts.attending ?? "-");
  setText("nextDeclinedCount", counts.declined ?? "-");
  setText("nextUnansweredCount", counts.unanswered ?? "-");

  setText("nextAttendingNames", listNames(event.attending));
  setText("nextDeclinedNames", listNames(event.declined));
  setText("nextUnansweredNames", listNames(event.unanswered));
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
}

function setHtml(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = value;
}

function setChance(id, value) {
  setText(id + "Chance", value + "%");

  const bar = document.getElementById(id + "Bar");
  if (bar) {
    bar.style.width = value + "%";
  }
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

function listLastMinuteDeclined(items) {
  if (!items || !items.length) return "-";
  return items.map(item => item.name).join(", ");
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

function formatCountdown(start) {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    return "-";
  }

  const diffMs = start.getTime() - Date.now();

  if (diffMs <= 0) {
    return "Bezig / vandaag";
  }

  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `Nog ${days}d ${hours}u`;
  }

  if (hours > 0) {
    return `Nog ${hours}u ${minutes}m`;
  }

  return `Nog ${minutes}m`;
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
