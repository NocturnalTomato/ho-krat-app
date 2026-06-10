let popupMode = null;
let lastPress = 0;
let eventData = null;
let chanceData = null;
let responses = {};
let countdownTimer = null;
let splitserData = null;
let splitserFullOpen = false;

const COOLDOWN_MS = 5000;
const SYNC_URL = "https://ho-krat-trigger.lucdegoeij.workers.dev/?key=aksjjkhdsadk2387or4ihfakhufahiueciahlcvhliarg9loahe3qtfh4789";
const SPLITSER_URL = "https://ho-krat-trigger.lucdegoeij.workers.dev/splitser-balance?key=aksjjkhdsadk2387or4ihfakhufahiueciahlcvhliarg9loahe3qtfh4789";
const POLL_TIMEOUT_MS = 60000;
const POLL_INTERVAL_MS = 3000;

async function init() {
  ensureSplitserCardExists();
  showSplitserDebug("Splitser-balans laden...");
  await loadResponses();

  loadEventData();
  loadSplitserData();
}

/* =========================
   SPLITSER
========================= */

function ensureSplitserCardExists() {
  if (document.getElementById("splitserCard")) return;

  const eventCard = document.getElementById("eventCard");
  const version = document.querySelector(".version");
  const card = document.querySelector(".card");

  const splitserCard = document.createElement("div");
  splitserCard.className = "splitser-card";
  splitserCard.id = "splitserCard";
  splitserCard.style.display = "block";

  splitserCard.innerHTML = `
    <div class="splitser-header">
      <div>
        <div class="splitser-kicker">KRATBALANS DER WAARHEID</div>
        <div class="splitser-title">Helden & Klaplopers</div>
      </div>
      <button class="mini-button" type="button" onclick="triggerDataSync()">Sync</button>
    </div>

    <div class="splitser-hero-box">
      <div class="splitser-label">Grootste Kratheilige</div>
      <div class="splitser-hero" id="splitserBigHero">-</div>
      <div class="splitser-amount" id="splitserBigHeroAmount">-</div>
    </div>

    <div class="splitser-columns">
      <div>
        <h4>Helden</h4>
        <ol class="splitser-list heroes-list" id="splitserHeroes"></ol>
      </div>
      <div>
        <h4>Wie moet het krat straks halen?</h4>
        <ol class="splitser-list klaplopers-list" id="splitserKlaplopers"></ol>
      </div>
    </div>

    <button class="splitser-toggle" id="splitserToggle" type="button" onclick="toggleSplitserFull()">
      Toon volledige schuldenlijst
    </button>

    <div class="splitser-full" id="splitserFullWrap" style="display:none;">
      <h4>Volledige financiële biecht</h4>
      <ol class="splitser-list full-list" id="splitserFullList"></ol>
    </div>
  `;

  if (eventCard) {
    eventCard.insertAdjacentElement("afterend", splitserCard);
  } else if (version && card) {
    card.insertBefore(splitserCard, version);
  } else if (card) {
    card.appendChild(splitserCard);
  }
}

function showSplitserDebug(message) {
  ensureSplitserCardExists();

  const card = document.getElementById("splitserCard");
  const hero = document.getElementById("splitserBigHero");
  const heroAmount = document.getElementById("splitserBigHeroAmount");
  const heroes = document.getElementById("splitserHeroes");
  const klaplopers = document.getElementById("splitserKlaplopers");
  const full = document.getElementById("splitserFullList");

  if (card) card.style.display = "block";
  if (hero) hero.textContent = message;
  if (heroAmount) heroAmount.textContent = "Debugmodus: de box is zichtbaar, nu wachten op data.";
  if (heroes) heroes.innerHTML = "";
  if (klaplopers) klaplopers.innerHTML = "";
  if (full) full.innerHTML = "";
}

async function triggerDataSync() {
  try {
    showSplitserDebug("Splitser-sync gestart...");

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

    showSplitserDebug("Splitser-sync mislukt.");
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

      console.log("SPLITSER POLL HTTP", response.status);

      if (!response.ok) continue;

      const freshData = await response.json();
      console.log("SPLITSER POLL DATA", freshData);

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
  showSplitserDebug("Splitser-balans laden...");

  const timeout = setTimeout(() => {
    if (!splitserData) {
      showSplitserDebug("Splitser is traag.");
      const status = document.getElementById("splitserStatus");
      if (status) {
        status.textContent = "Splitser is traag of reageert niet.";
        status.style.color = "#ffcc00";
      }
    }
  }, 12000);

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

    clearTimeout(timeout);
    renderSplitserStatus(splitserData);
  } catch (err) {
    clearTimeout(timeout);
    console.error("SPLITSER LOAD ERROR:", err);

    const status = document.getElementById("splitserStatus");
    if (status) {
      status.textContent = "Splitser-data niet bereikbaar.";
      status.style.color = "#ff5c5c";
    }

    showSplitserDebug("Splitser niet bereikbaar.");
  }
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

  let label = `Laatste Splitser-sync: ${ageMin} min geleden`;

  if (ageMin < 1) {
    label = "Laatste Splitser-sync: zojuist";
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
  ensureSplitserCardExists();

  const card = document.getElementById("splitserCard");
  const heroEl = document.getElementById("splitserBigHero");
  const heroAmountEl = document.getElementById("splitserBigHeroAmount");
  const heroesEl = document.getElementById("splitserHeroes");
  const klaplopersEl = document.getElementById("splitserKlaplopers");
  const fullListEl = document.getElementById("splitserFullList");

  if (!card || !heroEl || !heroAmountEl || !heroesEl || !klaplopersEl || !fullListEl) {
    console.error("Splitser HTML-elementen missen.");
    return;
  }

  card.style.display = "block";

  const members = normalizeSplitserMembers(data)
    .filter(member => Number.isFinite(member.amountCents));

  console.log("SPLITSER NORMALIZED MEMBERS", members);

  if (!members.length) {
    heroEl.textContent = "Geen leden gevonden.";
    heroAmountEl.textContent = "De Worker reageert wel, maar de app herkent de ledenlijst niet. Check console: SPLITSER DATA.";
    heroesEl.innerHTML = "";
    klaplopersEl.innerHTML = "";
    fullListEl.innerHTML = "";
    return;
  }

  const sortedHigh = [...members].sort((a, b) => b.amountCents - a.amountCents);
  const sortedLow = [...members].sort((a, b) => a.amountCents - b.amountCents);

  const biggestHero = sortedHigh[0];
  const top3High = sortedHigh.slice(0, 3);
  const top5Low = sortedLow.slice(0, 5);
  const top3Low = sortedLow.slice(0, 3);

  heroEl.textContent = getSplitserName(biggestHero);
  heroAmountEl.textContent = `${formatSplitserAmount(biggestHero)} in de plus. Deze man draagt het krat op zijn rug.`;

  heroesEl.innerHTML = "";
  top3High.forEach((member, index) => {
    heroesEl.appendChild(createSplitserRankItem(member, getHeroTitle(index, member)));
  });

  klaplopersEl.innerHTML = "";
  top5Low.forEach((member, index) => {
    klaplopersEl.appendChild(createSplitserRankItem(member, getKlaploperTitle(index, member)));
  });

  fullListEl.innerHTML = "";

  const top3HighKeys = new Set(top3High.map(member => member.id || getSplitserName(member)));
  const top3LowKeys = new Set(top3Low.map(member => member.id || getSplitserName(member)));

  sortedHigh.forEach(member => {
    const li = createSplitserRankItem(member, getSplitserName(member));
    const key = member.id || getSplitserName(member);

    if (top3HighKeys.has(key)) li.classList.add("top-plus");
    if (top3LowKeys.has(key)) li.classList.add("top-minus");

    fullListEl.appendChild(li);
  });
}

function normalizeSplitserMembers(data) {
  if (!data) return [];

  if (Array.isArray(data)) {
    return data.map(normalizeSplitserMember);
  }

  if (Array.isArray(data.members)) {
    return data.members.map(normalizeSplitserMember);
  }

  if (Array.isArray(data.data)) {
    return data.data.map(normalizeSplitserMember);
  }

  if (Array.isArray(data.balance)) {
    return data.balance.map(normalizeSplitserMember);
  }

  if (Array.isArray(data.member_totals)) {
    return data.member_totals.map(normalizeWbwMemberTotal);
  }

  if (Array.isArray(data.balance?.member_totals)) {
    return data.balance.member_totals.map(normalizeWbwMemberTotal);
  }

  if (Array.isArray(data.data?.balance?.member_totals)) {
    return data.data.balance.member_totals.map(normalizeWbwMemberTotal);
  }

  if (Array.isArray(data.data?.members)) {
    return data.data.members.map(normalizeSplitserMember);
  }

  return [];
}

function normalizeWbwMemberTotal(item) {
  const total = item.member_total || item;
  const member = total.member || {};
  const money = total.balance_total || {};

  return normalizeSplitserMember({
    id: member.id,
    name: member.nickname,
    fullName: member.full_name,
    amountCents: money.fractional,
    amount: money.formatted,
    isCurrent: member.is_current
  });
}

function normalizeSplitserMember(member) {
  const amountCents =
    toValidNumber(member.amountCents) ??
    toValidNumber(member.balanceCents) ??
    toValidNumber(member.cents) ??
    toValidNumber(member.fractional) ??
    parseAmountToCents(member.amount) ??
    parseAmountToCents(member.balance) ??
    0;

  return {
    id: member.id || member.memberId || member.name || member.fullName || member.full_name,
    name: member.name || member.nickname || member.fullName || member.full_name,
    fullName: member.fullName || member.full_name || member.name || member.nickname,
    amountCents,
    amount: member.amount || member.balance || null,
    isCurrent: member.isCurrent ?? member.is_current ?? true
  };
}

function createSplitserRankItem(member, title) {
  const li = document.createElement("li");

  const name = document.createElement("span");
  name.className = "rank-name";
  name.textContent = title;

  const amount = document.createElement("span");
  amount.className = "rank-amount";
  amount.textContent = formatSplitserAmount(member);

  li.appendChild(name);
  li.appendChild(amount);

  return li;
}

function toggleSplitserFull() {
  const wrap = document.getElementById("splitserFullWrap");
  const button = document.getElementById("splitserToggle");

  if (!wrap || !button) return;

  splitserFullOpen = !splitserFullOpen;
  wrap.style.display = splitserFullOpen ? "block" : "none";
  button.textContent = splitserFullOpen
    ? "Verberg de financiële ellende"
    : "Toon volledige schuldenlijst";
}

function getHeroTitle(index, member) {
  const name = getSplitserName(member);

  const titles = [
    `Kratheilige ${name}`,
    `Beschermheer ${name}`,
    `Gulle Gele ${name}`
  ];

  return titles[index] || name;
}

function getKlaploperTitle(index, member) {
  const name = getSplitserName(member);

  const titles = [
    `Kratplichtige ${name}`,
    `Hoofdelijk Omgeslagen ${name}`,
    `Financieel Verdwaalde ${name}`,
    `Mag fietsen ${name}`,
    `Kratontwijker ${name}`
  ];

  return titles[index] || name;
}

function getSplitserName(member) {
  return member.name || member.fullName || "Onbekende dorstige";
}

function formatSplitserAmount(member) {
  if (member.amount) return member.amount;

  return (member.amountCents / 100).toLocaleString("nl-NL", {
    style: "currency",
    currency: "EUR"
  });
}

function toValidNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseAmountToCents(value) {
  if (typeof value === "number") {
    return Math.round(value * 100);
  }

  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value
    .replace(/[^0-9,.-]/g, "")
    .replace(",", ".");

  const number = Number(cleaned);

  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.round(number * 100);
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

/* =========================
   HO KRAT BUTTON
========================= */

async function checkHoKrat() {
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
   HELPERS
========================= */

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
