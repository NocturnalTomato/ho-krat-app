const TARGET_GROUP_NAME = "Groen Geel - H8";
const API_BASE_URL = "https://api.spond.com/core/v1/";
const KNHB_MC = "https://publicaties.hockeyweerelt.nl/mc";
const CLUBI_BASE = "https://clubi.hockeyweerelt.nl";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
      ...(init.headers || {})
    }
  });
}

// XOR-based constant-time string comparison to avoid timing attacks.
// For this hockey-team use case the risk is extremely low, but it's
// trivial to implement and good practice for any password check.
function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const aBytes = enc.encode(String(a));
  const bBytes = enc.encode(String(b));
  const len = Math.max(aBytes.length, bBytes.length);
  let result = aBytes.length !== bBytes.length ? 1 : 0;
  for (let i = 0; i < len; i++) {
    result |= (aBytes[i] || 0) ^ (bBytes[i] || 0);
  }
  return result === 0;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === "/lineup") {
      if (request.method === "GET") {
        return handleLineupGet(env);
      }
      if (request.method === "POST") {
        return handleLineupPost(request, env);
      }
      return json({ success: false, error: "Method not allowed" }, { status: 405 });
    }

    if (url.pathname === "/stats") {
      if (request.method === "GET") return handleStatsGet(env);
      if (request.method === "POST") return handleStatsPost(request, env);
      if (request.method === "DELETE") return handleStatsDelete(request, env);
      return json({ success: false, error: "Method not allowed" }, { status: 405 });
    }

    if (url.pathname === "/past-matches") {
      if (request.method === "GET") return handlePastMatchesGet(env);
      return json({ success: false, error: "Method not allowed" }, { status: 405 });
    }

    if (url.pathname === "/standings") {
      if (request.method === "GET") return handleStandings(env, url);
      return json({ success: false, error: "Method not allowed" }, { status: 405 });
    }

    if (url.pathname === "/probe/knhb") {
      if (request.method === "GET") return handleProbeKnhb(env, url);
      return json({ success: false, error: "Method not allowed" }, { status: 405 });
    }
    if (url.pathname === "/probe/hw") {
      if (request.method === "GET") return handleProbeHw(env, url);
      return json({ success: false, error: "Method not allowed" }, { status: 405 });
    }
    if (url.pathname === "/probe/clubi") {
      if (request.method === "GET") return handleProbeClubi(url);
      return json({ success: false, error: "Method not allowed" }, { status: 405 });
    }

    if (url.pathname !== "/" && url.pathname !== "/spond") {
      return json(
        {
          success: false,
          error: "Unknown endpoint",
          endpoints: ["/", "/spond", "/lineup", "/stats", "/past-matches"]
        },
        { status: 404 }
      );
    }

    try {
      const output = await fetchSpondData(env);
      return json(output);
    } catch (err) {
      return json(
        {
          success: false,
          error: "Spond fetch failed",
          message: err.message
        },
        { status: 500 }
      );
    }
  }
};

async function handleLineupGet(env) {
  const defaultLineup = { formation: "4-3-3", positions: {}, extraPlayers: [], bench: [] };

  if (!env.LINEUP_KV) {
    return json(defaultLineup);
  }

  const raw = await env.LINEUP_KV.get("current");

  if (!raw) {
    return json(defaultLineup);
  }

  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.bench)) data.bench = [];
    return json(data);
  } catch {
    return json(defaultLineup);
  }
}

async function handleLineupPost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Ongeldige JSON" }, { status: 400 });
  }

  const { password, formation, positions, extraPlayers, bench } = body;

  if (!env.CAPTAIN_PASSWORD) {
    return json({ success: false, error: "Server niet geconfigureerd (geen secret)" }, { status: 500 });
  }

  if (!timingSafeEqual(password, env.CAPTAIN_PASSWORD)) {
    return json({ success: false, error: "Onjuist wachtwoord" }, { status: 401 });
  }

  if (!env.LINEUP_KV) {
    return json({ success: false, error: "KV niet geconfigureerd" }, { status: 500 });
  }

  const data = {
    formation: typeof formation === "string" ? formation : "4-3-3",
    positions: positions && typeof positions === "object" && !Array.isArray(positions) ? positions : {},
    extraPlayers: Array.isArray(extraPlayers) ? extraPlayers : [],
    bench: Array.isArray(bench) ? bench : [],
    updatedAt: new Date().toISOString()
  };

  await env.LINEUP_KV.put("current", JSON.stringify(data));

  return json({ success: true });
}

/* ============================================================
   MATCH STATS
============================================================ */

async function handleStatsGet(env) {
  if (!env.LINEUP_KV) return json({ matches: [] });
  const raw = await env.LINEUP_KV.get("all_match_stats");
  if (!raw) return json({ matches: [] });
  try {
    const matches = JSON.parse(raw);
    return json({ matches: Array.isArray(matches) ? matches : [] });
  } catch {
    return json({ matches: [] });
  }
}

async function handleStatsPost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Ongeldige JSON" }, { status: 400 });
  }

  const { password, matchStats } = body;

  if (!env.CAPTAIN_PASSWORD) {
    return json({ success: false, error: "Server niet geconfigureerd" }, { status: 500 });
  }
  if (!timingSafeEqual(password, env.CAPTAIN_PASSWORD)) {
    return json({ success: false, error: "Onjuist wachtwoord" }, { status: 401 });
  }
  if (!env.LINEUP_KV) {
    return json({ success: false, error: "KV niet geconfigureerd" }, { status: 500 });
  }
  // null matchStats means a password-only validation check
  if (!matchStats) {
    return json({ success: true, validated: true });
  }
  if (!matchStats.matchId) {
    return json({ success: false, error: "matchStats.matchId ontbreekt" }, { status: 400 });
  }

  const raw = await env.LINEUP_KV.get("all_match_stats");
  let matches = [];
  try { matches = raw ? JSON.parse(raw) : []; } catch { matches = []; }
  if (!Array.isArray(matches)) matches = [];

  const idx = matches.findIndex(m => m.matchId === matchStats.matchId);
  const entry = { ...matchStats, updatedAt: new Date().toISOString() };
  if (idx >= 0) {
    matches[idx] = entry;
  } else {
    matches.push(entry);
  }
  matches.sort((a, b) => b.date.localeCompare(a.date));

  await env.LINEUP_KV.put("all_match_stats", JSON.stringify(matches));
  return json({ success: true });
}

async function handleStatsDelete(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Ongeldige JSON" }, { status: 400 });
  }

  const { password, matchId } = body;

  if (!env.CAPTAIN_PASSWORD) {
    return json({ success: false, error: "Server niet geconfigureerd" }, { status: 500 });
  }
  if (!timingSafeEqual(password, env.CAPTAIN_PASSWORD)) {
    return json({ success: false, error: "Onjuist wachtwoord" }, { status: 401 });
  }
  if (!matchId) {
    return json({ success: false, error: "matchId ontbreekt" }, { status: 400 });
  }
  if (!env.LINEUP_KV) {
    return json({ success: false, error: "KV niet geconfigureerd" }, { status: 500 });
  }

  const raw = await env.LINEUP_KV.get("all_match_stats");
  let matches = [];
  try { matches = raw ? JSON.parse(raw) : []; } catch { matches = []; }

  const before = matches.length;
  matches = matches.filter(m => m.matchId !== matchId);

  if (matches.length === before) {
    return json({ success: false, error: "Wedstrijd niet gevonden" }, { status: 404 });
  }

  await env.LINEUP_KV.put("all_match_stats", JSON.stringify(matches));
  return json({ success: true });
}

/* ============================================================
   PAST MATCHES (for stats editor dropdown)
============================================================ */

async function handlePastMatchesGet(env) {
  if (!env.SPOND_USERNAME || !env.SPOND_PASSWORD) {
    return json({ matches: [], error: "Spond niet geconfigureerd" });
  }

  try {
    const token = await loginToSpond(env.SPOND_USERNAME, env.SPOND_PASSWORD);
    const now = new Date();

    const twoSeasonsBack = new Date(now);
    twoSeasonsBack.setFullYear(twoSeasonsBack.getFullYear() - 2);
    const minStartTs = twoSeasonsBack.toISOString();
    const maxEndTs = now.toISOString();

    // Helper: does this event array contain any past non-training events?
    function hasPastMatches(evts) {
      if (!Array.isArray(evts)) return false;
      return evts.some(e => {
        if (!e.startTimestamp) return false;
        if (new Date(e.startTimestamp) >= now) return false;
        return !String(e.heading || "").toLowerCase().includes("training");
      });
    }

    // Try strategies in order — stop at the first that returns past match data.
    // We check actual content, not just whether the call threw, because Spond
    // may silently ignore unknown query params and return an empty/future-only list.
    const queries = [
      `sponds/?max=200&minStartTimestamp=${minStartTs}&maxEndTimestamp=${maxEndTs}`,
      `sponds/?max=200&maxEndTimestamp=${maxEndTs}`,
      `sponds/?max=500&scheduled=false`,
      `sponds/?max=500`,
    ];

    let events = [];
    let debugStrategy = -1;
    for (let i = 0; i < queries.length; i++) {
      try {
        const result = await spondGet(queries[i], token);
        if (hasPastMatches(result)) {
          events = result;
          debugStrategy = i;
          break;
        }
      } catch { /* try next */ }
    }

    if (!Array.isArray(events)) events = [];

    // Filter to past non-training events (wedstrijden, TD, tournaments, etc.)
    // We exclude "training" by name; everything else that's in the past is fair game.
    // Also expose the raw heading so the UI can show/use it.
    const pastMatches = events
      .filter(e => {
        if (!e.startTimestamp) return false;
        if (new Date(e.startTimestamp) >= now) return false;
        const name = String(e.heading || "").toLowerCase();
        return !name.includes("training");
      })
      .sort((a, b) => new Date(b.startTimestamp) - new Date(a.startTimestamp))
      .slice(0, 60);

    if (!pastMatches.length) {
      return json({ matches: [], debug: { strategy: debugStrategy, totalEvents: events.length } });
    }

    // Try app.hockeyweerelt.nl first (needs device auth), then publicaties.hockeyweerelt.nl
    const hwMatches = await fetchHwPlayedMatches(env);
    const knhbMatches = hwMatches ? null : await fetchKnhbPlayedMatches(env);

    // Build a date → {opponent, goalsFor, goalsAgainst} lookup from whichever source worked
    const enrichMap = new Map();
    if (hwMatches) {
      for (const m of hwMatches) {
        if (m.date) enrichMap.set(m.date, m);
      }
    } else if (knhbMatches) {
      for (const km of knhbMatches) {
        const dt = String(km.datetime || km.date || km.start_date || km.match_date || "").substring(0, 10);
        if (!dt) continue;
        const homeName = km.home_team?.name || km.home?.name || "";
        const awayName = km.away_team?.name || km.away?.name || "";
        const isOurHome = homeName.toLowerCase().includes("groen") || homeName.toLowerCase().includes("geel");
        const hs = km.home_score ?? km.score?.home ?? km.result?.home ?? null;
        const as_ = km.away_score ?? km.score?.away ?? km.result?.away ?? null;
        enrichMap.set(dt, {
          opponent: isOurHome ? awayName : homeName,
          goalsFor: hs !== null && as_ !== null ? (isOurHome ? Number(hs) : Number(as_)) : null,
          goalsAgainst: hs !== null && as_ !== null ? (isOurHome ? Number(as_) : Number(hs)) : null,
        });
      }
    }

    const formatted = pastMatches.map(e => {
      const date = e.startTimestamp.substring(0, 10);
      const heading = String(e.heading || "");
      const subHeading = String(e.subHeading || "");
      const description = String(e.description || "");
      const lower = heading.toLowerCase();
      const isHome = lower.includes("thuis");

      // Prefer API-sourced enrichment
      const enrich = enrichMap.get(date);
      let opponent = enrich?.opponent || "";
      let goalsFor = enrich?.goalsFor ?? null;
      let goalsAgainst = enrich?.goalsAgainst ?? null;

      // --- Spond heading/subHeading/description fallback for opponent ---
      if (!opponent) {
        // Try all text sources in order
        const sources = [heading, subHeading, description].filter(Boolean);
        for (const text of sources) {
          const t = text.toLowerCase();

          // "bij <Club>" — away match description
          if (t.includes("bij ")) {
            opponent = text.substring(t.indexOf("bij ") + 4).split(/[\n,]/)[0].trim();
            break;
          }
          // "tegen <Club>" — "against <Club>"
          if (t.includes("tegen ")) {
            opponent = text.substring(t.indexOf("tegen ") + 6).split(/[\n,–\-]/)[0].trim();
            break;
          }
          // "vs <Club>" or "versus <Club>"
          const vsM = text.match(/\bversus\s+(.+?)(?:\s*[–\-]|$)/i) ||
                      text.match(/\bvs\.?\s+(.+?)(?:\s*[–\-]|$)/i);
          if (vsM) { opponent = vsM[1].trim(); break; }

          // "<GG> – <Opponent>" or "<Opponent> – <GG>"
          const parts = text.split(/\s*[–\-]\s*/);
          if (parts.length >= 2) {
            const isUs = p => /groen|geel|\bgg\b|\bh ?8\b/i.test(p);
            if (isUs(parts[0])) { opponent = parts[1].trim(); break; }
            if (isUs(parts[1])) { opponent = parts[0].trim(); break; }
          }

          // "Wedstrijd: <GG> – <Opponent>" — text after colon
          if (text.includes(":")) {
            const afterColon = text.split(":").slice(1).join(":").trim();
            const colonParts = afterColon.split(/\s*[–\-]\s*/);
            if (colonParts.length >= 2) {
              const isUs = p => /groen|geel|\bgg\b|\bh ?8\b/i.test(p);
              if (isUs(colonParts[0])) { opponent = colonParts[1].trim(); break; }
              if (isUs(colonParts[1])) { opponent = colonParts[0].trim(); break; }
            }
          }
        }
      }

      // Strip any trailing score like "3-2" or "(3-2)" from extracted opponent
      opponent = opponent.replace(/\s*[\(\[]?\d+\s*[-–]\s*\d+[\)\]]?\s*$/, "").trim();

      return { id: e.id, date, heading, isHome, opponent, goalsFor, goalsAgainst };
    });

    const enrichSource = hwMatches ? "hw" : (knhbMatches ? "knhb" : "none");
    return json({ matches: formatted, debug: { strategy: debugStrategy, totalEvents: events.length, enrichSource } });
  } catch (err) {
    return json({ matches: [], error: err.message });
  }
}

async function fetchKnhbPlayedMatches(env) {
  try {
    let teamId = env.LINEUP_KV ? await env.LINEUP_KV.get("knhb_team_id") : null;
    if (!teamId) {
      teamId = await discoverKnhbTeamId(env);
      if (!teamId) return null;
    }

    // Try several endpoints for historical match data
    for (const suffix of ["matches/played", "matches", "schedule"]) {
      try {
        const res = await fetch(`${KNHB_MC}/teams/${teamId}/${suffix}`, {
          headers: { "User-Agent": "ho-krat-app/1.0", "Accept": "application/json" }
        });
        if (!res.ok) continue;
        const data = await res.json();
        const matches = data.data;
        if (Array.isArray(matches) && matches.length > 0) return matches;
      } catch { /* try next */ }
    }
    return null;
  } catch {
    return null;
  }
}

/* ============================================================
   SPOND DATA FETCHING (unchanged from original)
============================================================ */

async function fetchSpondData(env) {
  if (!env.SPOND_USERNAME || !env.SPOND_PASSWORD) {
    throw new Error("Missing SPOND_USERNAME or SPOND_PASSWORD secret");
  }

  const token = await loginToSpond(env.SPOND_USERNAME, env.SPOND_PASSWORD);

  const groups = await spondGet("groups/", token);
  const events = await spondGet("sponds/?max=50&scheduled=false", token);

  const targetGroup = groups.find(group => group.name === TARGET_GROUP_NAME) || null;
  const memberLookup = buildMemberLookup(targetGroup);

  const now = new Date();

  // An event that has already started still counts as the event of the day for
  // the Ho-krat check (instead of vanishing the moment it begins) up to 23:59
  // of the same calendar day. "Same day" is measured in the team's local time
  // zone so it lines up with the browser's isToday check in the app.
  const EVENT_TIME_ZONE = "Europe/Amsterdam";
  const localDayKey = date =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: EVENT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);

  const nowDayKey = localDayKey(now);

  const relevantEvents = events.filter(
    event => event.startTimestamp && isRelevantEvent(event)
  );

  // Ongoing or already-started events, still on today's date (until 23:59).
  const currentEvents = relevantEvents
    .filter(event => {
      const start = new Date(event.startTimestamp);
      return start <= now && localDayKey(start) === nowDayKey;
    })
    .sort((a, b) => new Date(b.startTimestamp) - new Date(a.startTimestamp));

  // Genuinely future events.
  const futureEvents = relevantEvents
    .filter(event => new Date(event.startTimestamp) > now)
    .sort((a, b) => new Date(a.startTimestamp) - new Date(b.startTimestamp));

  const currentEvent = currentEvents[0] || null;
  const firstEvent = futureEvents[0] || null;
  const secondEvent = futureEvents[1] || null;

  const toEventOutput = event => ({
    id: event.id,
    name: event.heading,
    startTimestamp: event.startTimestamp,
    endTimestamp: event.endTimestamp,
    location: event.location || null,
    type: getEventType(event),
    ...extractAttendance(event, memberLookup)
  });

  const output = {
    updatedAt: now.toISOString(),
    team: TARGET_GROUP_NAME,
    groupId: targetGroup?.id || null,
    memberCount: Array.isArray(targetGroup?.members) ? targetGroup.members.length : null,
    members: Object.values(memberLookup).sort(),
    currentEvent: currentEvent ? toEventOutput(currentEvent) : null,
    upcomingEvent: firstEvent ? toEventOutput(firstEvent) : null,
    nextEvent: secondEvent ? toEventOutput(secondEvent) : null
  };

  const knhbMatches = await fetchKnhbData(env);
  if (output.currentEvent) output.currentEvent = enrichWithKnhb(output.currentEvent, knhbMatches);
  if (output.upcomingEvent) output.upcomingEvent = enrichWithKnhb(output.upcomingEvent, knhbMatches);
  if (output.nextEvent) output.nextEvent = enrichWithKnhb(output.nextEvent, knhbMatches);

  return output;
}

async function loginToSpond(username, password) {
  const response = await fetch(API_BASE_URL + "auth2/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "ho-krat-spond-worker"
    },
    body: JSON.stringify({ email: username, password: password })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Login failed: HTTP ${response.status}`);
  }

  const token = data?.accessToken?.token;
  if (!token) throw new Error("Login failed: no access token returned");

  return token;
}

async function spondGet(path, token) {
  const response = await fetch(API_BASE_URL + path, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "User-Agent": "ho-krat-spond-worker"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Spond GET ${path} failed: HTTP ${response.status} ${text}`);
  }

  return JSON.parse(text);
}

function isRelevantEvent(event) {
  const name = String(event.heading || "").toLowerCase();
  return (
    name.includes("training") ||
    name.includes("thuis") ||
    name.includes("uit") ||
    name.includes("td")
  );
}

function getEventType(event) {
  const name = String(event.heading || "").toLowerCase();
  if (name.includes("training")) return "training";
  if (name.includes("td")) return "td";
  return "wedstrijd";
}

function buildMemberLookup(group) {
  const lookup = {};
  if (!group || !Array.isArray(group.members)) return lookup;

  for (const member of group.members) {
    const memberId = member.id;
    const name = `${member.firstName || ""} ${member.lastName || ""}`.trim();
    if (memberId && name) lookup[memberId] = name;
  }

  return lookup;
}

function personName(personId, memberLookup) {
  return memberLookup[personId] || personId;
}

function extractAttendance(event, memberLookup) {
  const responses = event.responses || {};

  const attending = (responses.acceptedIds || []).map(id => personName(id, memberLookup)).sort();
  const declined = (responses.declinedIds || []).map(id => personName(id, memberLookup)).sort();
  const unanswered = (responses.unansweredIds || []).map(id => personName(id, memberLookup)).sort();

  return {
    attending,
    declined,
    unanswered,
    counts: {
      attending: attending.length,
      declined: declined.length,
      unanswered: unanswered.length
    }
  };
}

/* ============================================================
   KNHB MATCH DATA
============================================================ */

async function fetchKnhbData(env) {
  try {
    let teamId = env.LINEUP_KV ? await env.LINEUP_KV.get("knhb_team_id") : null;
    if (!teamId) {
      teamId = await discoverKnhbTeamId(env);
      if (!teamId) return null;
    }

    const res = await fetch(`${KNHB_MC}/teams/${teamId}/matches/upcoming`, {
      headers: { "User-Agent": "ho-krat-app/1.0", "Accept": "application/json" }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data || null;
  } catch {
    return null;
  }
}

async function discoverKnhbTeamId(env) {
  try {
    const clubsRes = await fetch(`${KNHB_MC}/clubs`, {
      headers: { "User-Agent": "ho-krat-app/1.0", "Accept": "application/json" }
    });
    if (!clubsRes.ok) return null;
    const clubs = (await clubsRes.json()).data || [];

    const club = clubs.find(c => {
      const n = (c.name || "").toLowerCase().replace(/-/g, " ");
      return n.includes("groen") && n.includes("geel");
    });
    if (!club) return null;

    const teamsRes = await fetch(`${KNHB_MC}/clubs/${club.id}/teams`, {
      headers: { "User-Agent": "ho-krat-app/1.0", "Accept": "application/json" }
    });
    if (!teamsRes.ok) return null;
    const teams = (await teamsRes.json()).data || [];

    const team = teams.find(t => {
      const n = (t.name || t.short_name || t.full_name || "").toLowerCase().trim().replace(/\s+/g, " ");
      return n === "heren 8" || n === "h8" || n === "h 8" ||
        n.endsWith(" h8") || n.endsWith(" h 8") || n.endsWith(" heren 8") ||
        /^h ?8$/.test(n) || (n.includes("heren") && /\b8\b/.test(n));
    });
    if (!team) return null;

    if (env.LINEUP_KV) {
      await env.LINEUP_KV.put("knhb_team_id", String(team.id), { expirationTtl: 86400 });
    }
    return String(team.id);
  } catch {
    return null;
  }
}

/* ============================================================
   app.hockeyweerelt.nl API  (used by hockey-team-tracker)
   Requires device registration (UUID + token) and SHA-1 signed
   request headers.
============================================================ */

const HW_BASE = "https://app.hockeyweerelt.nl";

async function hwSha1(message) {
  const data = new TextEncoder().encode(message);
  const buf = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hwSignature(urlPath, params, timestamp, uuid) {
  // Algorithm from joosthoi1/HockeyWeerelt – strip non-alphanum/dash/slash chars,
  // concat params WITHOUT separator, append reversed UUID.
  const cleanPath = urlPath.replace(/[^a-zA-Z0-9\-\/]+/g, "");
  const cleanedParams = Object.entries(params)
    .filter(([k]) => k)
    .map(([k, v]) => `${k.replace(/[^a-zA-Z0-9\-\/=]+/g, "")}=${String(v).replace(/[^a-zA-Z0-9\-\/=]+/g, "")}`)
    .join("");
  const reversedUuid = [...String(uuid)].reverse().join("");
  return hwSha1(`${timestamp}${cleanPath}${cleanedParams}${reversedUuid}`);
}

async function hwRequest(path, params = {}, method = "GET", uuid, token) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = await hwSignature(path, params, timestamp, uuid || "");
  // Params always go into the URL query string (matches aiohttp params= behaviour)
  const url = new URL(HW_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
  const headers = {
    "Accept": "application/json",
    "X-HAPI-Signature": sig,
    "X-HAPI-Timestamp": String(timestamp),
  };
  if (token) headers["X-HAPI-Authorization"] = token;
  const res = await fetch(url.toString(), { method, headers });
  if (!res.ok) throw new Error(`HW ${res.status} ${path}`);
  return await res.json();
}

async function hwGetOrCreateDevice(env) {
  if (env.LINEUP_KV) {
    const uuid = await env.LINEUP_KV.get("hw_uuid");
    const token = await env.LINEUP_KV.get("hw_token");
    if (uuid && token) return { uuid, token };
  }
  const uuid = crypto.randomUUID();
  const r = await hwRequest("/device/register", { os: "Web", uuid }, "POST", uuid, null);
  const token = r.token || r.data?.token;
  if (!token) throw new Error("HW device registration failed");
  if (env.LINEUP_KV) {
    await env.LINEUP_KV.put("hw_uuid", uuid, { expirationTtl: 86400 * 90 });
    await env.LINEUP_KV.put("hw_token", token, { expirationTtl: 86400 * 90 });
  }
  return { uuid, token };
}

async function hwFindTeamId(env, uuid, token) {
  if (env.LINEUP_KV) {
    const stored = await env.LINEUP_KV.get("hw_team_id");
    if (stored) return stored;
  }

  // GET /clubs → find Groen Geel by name
  const clubsData = await hwRequest("/clubs", {}, "GET", uuid, token);
  const clubs = clubsData.data || clubsData || [];
  const club = Array.isArray(clubs) && clubs.find(c => {
    const n = (c.name || "").toLowerCase().replace(/-/g, " ");
    return n.includes("groen") && n.includes("geel");
  });
  if (!club) return null;

  const clubRef = club.federation_reference_id || club.id;

  // GET /clubs/{ref} → teams nested in response
  const clubData = await hwRequest(`/clubs/${clubRef}`, {}, "GET", uuid, token);
  const teamList = clubData.data?.teams || clubData.teams ||
    (Array.isArray(clubData.data) ? clubData.data : null) || [];

  const team = Array.isArray(teamList) && teamList.find(t => {
    const short = (t.short_name || "").toLowerCase().trim();
    const full = (t.name || t.full_name || "").toLowerCase();
    const type = (t.hockey_type || "").toLowerCase();
    return short === "h8" || short === "8" ||
      full.includes("heren 8") || full === "h8" ||
      (type.includes("heren") && /\b8\b/.test(short + " " + full));
  });
  if (!team) return null;

  const teamId = String(team.id);
  if (env.LINEUP_KV) {
    await env.LINEUP_KV.put("hw_team_id", teamId, { expirationTtl: 86400 * 30 });
  }
  return teamId;
}

async function fetchHwPlayedMatches(env) {
  try {
    const { uuid, token } = await hwGetOrCreateDevice(env);
    const teamId = await hwFindTeamId(env, uuid, token);
    if (!teamId) return null;

    // GET /matches/team?team_id[]={teamId}
    const data = await hwRequest("/matches/team", { "team_id[]": teamId }, "GET", uuid, token);
    const matches = data.data || data;
    if (!Array.isArray(matches) || !matches.length) return null;

    const now = new Date();
    const teamIdInt = parseInt(teamId, 10);

    return matches
      .filter(m => {
        const d = m.date || m.start_date || m.datetime || "";
        return d && new Date(d) < now && m.status !== "scheduled" && m.status !== "announced";
      })
      .map(m => {
        const date = (m.date || m.start_date || m.datetime || "").substring(0, 10);
        const isOurHome = (m.home?.id ?? m.home_team?.id) === teamIdInt;
        const homeName = m.home?.name || m.home?.team_name || m.home_team?.name || "";
        const awayName = m.away?.name || m.away?.team_name || m.away_team?.name || "";
        const opponent = isOurHome ? awayName : homeName;
        const hs = m.home_score ?? m.score?.home ?? m.home?.score ?? null;
        const as_ = m.away_score ?? m.score?.away ?? m.away?.score ?? null;
        const goalsFor = hs !== null && as_ !== null ? (isOurHome ? Number(hs) : Number(as_)) : null;
        const goalsAgainst = hs !== null && as_ !== null ? (isOurHome ? Number(as_) : Number(hs)) : null;
        return { date, opponent, goalsFor, goalsAgainst };
      });
  } catch {
    return null;
  }
}

/* ============================================================
   PROBE — focused API discovery, split across sub-endpoints
   Each handler makes ≤4 HTTP fetches to stay under the
   Cloudflare Workers free-plan subrequest limit (50/invocation).

   GET /probe/knhb          discover club/team, test played endpoint
   GET /probe/knhb?teamId=X skip discovery, just test matches
   GET /probe/hw            discover team via HockeyWeerelt API
   GET /probe/hw?teamId=X   skip discovery, just test matches
   GET /probe/clubi         test clubi.hockeyweerelt.nl
============================================================ */

// ---------- Poule standings ----------
async function handleStandings(env, url) {
  try {
    const { uuid, token } = await hwGetOrCreateDevice(env);

    // Try KV-cached IDs first (populated by probe or previous standings call)
    let teamId = env.LINEUP_KV ? await env.LINEUP_KV.get("hw_team_id") : null;
    let recentPouleId = env.LINEUP_KV ? await env.LINEUP_KV.get("hw_recent_poule_id") : null;

    // Discovery: only runs when no cached team ID
    if (!teamId) {
      const clubsData = await hwRequest("/clubs", {}, "GET", uuid, token);
      const clubs = clubsData.data || clubsData;
      const gg = Array.isArray(clubs) && clubs.find(c => {
        const n = (c.name || "").toLowerCase().replace(/-/g, " ");
        return n.includes("groen") && n.includes("geel");
      });
      if (!gg) return json({ error: "Club niet gevonden" }, { status: 404 });

      const clubRef = gg.federation_reference_id || gg.id;
      const clubData = await hwRequest(`/clubs/${clubRef}`, {}, "GET", uuid, token);
      const teamList = clubData.data?.teams || clubData.teams || [];
      const h8 = Array.isArray(teamList) && teamList.find(t => {
        const short = (t.short_name || "").toLowerCase().trim();
        return short === "h8" || short === "8";
      });
      if (!h8) return json({ error: "Team H8 niet gevonden" }, { status: 404 });

      teamId = String(h8.id);
      if (h8.recent_poule_id) recentPouleId = String(h8.recent_poule_id);

      if (env.LINEUP_KV) {
        await env.LINEUP_KV.put("hw_team_id", teamId, { expirationTtl: 86400 * 30 });
        if (recentPouleId) await env.LINEUP_KV.put("hw_recent_poule_id", recentPouleId, { expirationTtl: 86400 * 7 });
      }
    }

    // Try to get all poules this team has participated in (for season selector)
    let teamPoules = [];
    try {
      const poulesData = await hwRequest(`/teams/${teamId}/poules`, {}, "GET", uuid, token);
      const arr = poulesData.data || poulesData;
      if (Array.isArray(arr) && arr.length > 0) teamPoules = arr;
    } catch (_) {}

    // Determine which poule to show
    const requestedPouleId = url.searchParams.get("poule_id") || recentPouleId || "174656";

    // Fetch the poule (standings + competition info are embedded here)
    const pouleData = await hwRequest(`/poules/${requestedPouleId}`, {}, "GET", uuid, token);
    const inner = pouleData.data || pouleData;
    const rawStandings = Array.isArray(inner.standings) ? inner.standings : [];

    const standings = rawStandings.map(s => ({
      rank: s.rank ?? null,
      team_id: s.team?.id ?? null,
      team_name: s.team?.name ?? s.team_name ?? "?",
      team_short: s.team?.short_name ?? null,
      played: s.played ?? s.matches_played ?? 0,
      won: s.won ?? s.wins ?? null,
      drawn: s.drawn ?? s.draws ?? s.tied ?? null,
      lost: s.lost ?? s.losses ?? null,
      points_deducted: s.points_deducted ?? s.penalty_points ?? s.deductions ?? 0,
      points: s.points ?? 0,
    }));

    // Build poule options for the season selector
    const pouleOptions = teamPoules.length > 1
      ? teamPoules.map(p => ({
          id: String(p.id ?? p.poule_id),
          label: p.name || p.competition?.name || String(p.id ?? p.poule_id),
        }))
      : [{ id: String(requestedPouleId), label: inner.competition?.name || `Poule ${requestedPouleId}` }];

    return json({
      poule_id: String(requestedPouleId),
      competition: inner.competition?.name ?? null,
      poule_options: pouleOptions,
      standings,
    });
  } catch (e) {
    return json({ error: e.message }, { status: 500 });
  }
}

// ---------- KNHB probe (max 4 HTTP fetches) ----------
async function handleProbeKnhb(env, url) {
  const provided = url.searchParams.get("teamId");

  // If teamId supplied, skip discovery and go straight to match data
  if (provided) {
    return json(await probeKnhbMatches(provided));
  }

  // Step 1 — clubs: use redirect:manual to diagnose the redirect loop
  // Also try the known club ref from HW (HH11GF7) directly to skip clubs discovery
  let clubs;
  const KNOWN_CLUB_REF = "HH11GF7"; // from HW team.federation_reference_id
  try {
    const r = await fetch(`${KNHB_MC}/clubs`, {
      redirect: 'manual',
      headers: { "User-Agent": "ho-krat-app/1.0", "Accept": "application/json" }
    });
    if (r.status >= 300 && r.status < 400) {
      const location = r.headers.get('Location') || r.headers.get('location') || '';
      const hdrs = {};
      for (const [k, v] of r.headers.entries()) hdrs[k] = v;
      const redirectBody = await r.text();

      // Clubs discovery is blocked — try the known KNHB club ref directly
      let directResult = {};
      try {
        const r2 = await fetch(`${KNHB_MC}/clubs/${KNOWN_CLUB_REF}/teams`, {
          headers: { "User-Agent": "ho-krat-app/1.0", "Accept": "application/json" }
        });
        const body2 = await r2.text();
        if (r2.ok) {
          const d = JSON.parse(body2);
          const teams = d.data || d;
          directResult = { status: r2.status, count: Array.isArray(teams) ? teams.length : typeof teams, sample: Array.isArray(teams) ? teams.slice(0, 5).map(t => `${t.id}: ${t.name}/${t.short_name}`) : body2.substring(0, 300) };
          if (Array.isArray(teams)) {
            const h8 = teams.find(t => {
              const n = (t.name || t.short_name || "").toLowerCase().trim().replace(/\s+/g, " ");
              return n === "heren 8" || n === "h8" || n.endsWith(" h8") || (n.includes("heren") && /\b8\b/.test(n));
            });
            if (h8) {
              if (env.LINEUP_KV) await env.LINEUP_KV.put("knhb_team_id", String(h8.id), { expirationTtl: 86400 });
              const matchResult = await probeKnhbMatches(String(h8.id));
              directResult.h8 = { id: h8.id, name: h8.name };
              directResult.matches = matchResult;
            }
          }
        } else {
          directResult = { status: r2.status, body: body2.substring(0, 300) };
        }
      } catch (e) {
        directResult = { error: e.message };
      }

      return json({ step: "clubs_redirect", status: r.status, location, redirect_body: redirectBody.substring(0, 300), all_headers: hdrs, direct_club_ref: directResult });
    }
    if (!r.ok) return json({ step: "clubs", status: r.status, body: (await r.text()).substring(0, 500) });
    clubs = ((await r.json()).data || []);
  } catch (e) {
    return json({ step: "clubs", error: e.message });
  }

  const gg = clubs.find(c => {
    const n = (c.name || "").toLowerCase().replace(/-/g, " ");
    return n.includes("groen") && n.includes("geel");
  });
  if (!gg) return json({ step: "clubs", count: clubs.length, error: "GG not found", sample: clubs.slice(0, 5).map(c => c.name) });

  // Step 2 — teams (1 fetch)
  let teams;
  try {
    const r = await fetch(`${KNHB_MC}/clubs/${gg.id}/teams`, {
      headers: { "User-Agent": "ho-krat-app/1.0", "Accept": "application/json" }
    });
    if (!r.ok) return json({ step: "teams", club: gg.name, status: r.status });
    teams = ((await r.json()).data || []);
  } catch (e) {
    return json({ step: "teams", error: e.message });
  }

  const h8 = teams.find(t => {
    const n = (t.name || t.short_name || "").toLowerCase().replace(/\s+/g, " ").trim();
    return n === "heren 8" || n === "h8" || n === "h 8" ||
      n.endsWith(" h8") || n.endsWith(" h 8") || n.endsWith(" heren 8") ||
      (n.includes("heren") && /\b8\b/.test(n));
  });
  if (!h8) return json({ step: "teams", club: gg.name, teams: teams.map(t => `${t.id}: ${t.name} / ${t.short_name}`), error: "H8 not found" });

  // Cache the team ID
  if (env.LINEUP_KV) await env.LINEUP_KV.put("knhb_team_id", String(h8.id), { expirationTtl: 86400 });

  // Steps 3+4 — match data
  const matchResult = await probeKnhbMatches(String(h8.id));
  return json({ club: gg.name, club_id: gg.id, team: h8.name, team_id: h8.id, ...matchResult });
}

async function probeKnhbMatches(teamId) {
  // fetch 1: played
  let playedResult = {};
  try {
    const r = await fetch(`${KNHB_MC}/teams/${teamId}/matches/played`, {
      headers: { "User-Agent": "ho-krat-app/1.0", "Accept": "application/json" }
    });
    const text = await r.text();
    if (r.ok) {
      const d = JSON.parse(text);
      const arr = d.data || d.matches || (Array.isArray(d) ? d : null);
      playedResult = {
        played_status: r.status,
        played_count: Array.isArray(arr) ? arr.length : null,
        played_keys: Object.keys(d),
        played_sample: Array.isArray(arr) ? arr.slice(0, 2) : d
      };
    } else {
      playedResult = { played_status: r.status, played_body: text.substring(0, 300) };
    }
  } catch (e) {
    playedResult = { played_error: e.message };
  }

  // fetch 2: all matches (fallback)
  let allResult = {};
  try {
    const r = await fetch(`${KNHB_MC}/teams/${teamId}/matches`, {
      headers: { "User-Agent": "ho-krat-app/1.0", "Accept": "application/json" }
    });
    if (r.ok) {
      const d = await r.json();
      const arr = d.data || (Array.isArray(d) ? d : null);
      allResult = {
        all_status: r.status,
        all_count: Array.isArray(arr) ? arr.length : null,
        all_sample: Array.isArray(arr) ? arr.slice(0, 2) : null
      };
    } else {
      allResult = { all_status: r.status };
    }
  } catch (e) {
    allResult = { all_error: e.message };
  }

  return { team_id: teamId, ...playedResult, ...allResult };
}

// ---------- HockeyWeerelt probe (max 3 HTTP + 2 KV) ----------
async function handleProbeHw(env, url) {
  const provided = url.searchParams.get("teamId");

  try {
    const { uuid, token } = await hwGetOrCreateDevice(env);

    if (provided) {
      return json(await probeHwMatches(provided, uuid, token));
    }

    // fetch 1: clubs
    const clubsData = await hwRequest("/clubs", {}, "GET", uuid, token);
    const clubs = clubsData.data || clubsData;
    if (!Array.isArray(clubs)) return json({ step: "clubs", type: typeof clubs, raw: JSON.stringify(clubs).substring(0, 300) });

    const gg = clubs.find(c => {
      const n = (c.name || "").toLowerCase().replace(/-/g, " ");
      return n.includes("groen") && n.includes("geel");
    });
    if (!gg) return json({ step: "clubs", count: clubs.length, error: "GG not found", sample: clubs.slice(0, 5).map(c => c.name) });

    // fetch 2: club detail (teams)
    const clubRef = gg.federation_reference_id || gg.id;
    const clubData = await hwRequest(`/clubs/${clubRef}`, {}, "GET", uuid, token);
    const teamList = clubData.data?.teams || clubData.teams || (Array.isArray(clubData.data) ? clubData.data : null) || [];

    const h8 = Array.isArray(teamList) && teamList.find(t => {
      const short = (t.short_name || "").toLowerCase().trim();
      const full = (t.name || t.full_name || "").toLowerCase();
      return short === "h8" || short === "8" || full.includes("heren 8") || full === "h8";
    });
    if (!h8) return json({ step: "club_detail", club: gg.name, teams: Array.isArray(teamList) ? teamList.map(t => `${t.id}: ${t.short_name}/${t.name}`) : [], error: "H8 not found" });

    if (env.LINEUP_KV) {
      await env.LINEUP_KV.put("hw_team_id", String(h8.id), { expirationTtl: 86400 * 30 });
      if (h8.recent_poule_id) await env.LINEUP_KV.put("hw_recent_poule_id", String(h8.recent_poule_id), { expirationTtl: 86400 * 7 });
    }

    // fetch 3+: matches (multiple attempts)
    const matchResult = await probeHwMatches(String(h8.id), uuid, token, h8.recent_poule_id);
    return json({ club: gg.name, team: h8.name, team_id: h8.id, team_obj: h8, ...matchResult });
  } catch (e) {
    return json({ error: e.message });
  }
}

async function probeHwMatches(teamId, uuid, token, pouleId) {
  const results = {};

  // 1: basic team matches (often empty in off-season)
  try {
    const data = await hwRequest("/matches/team", { "team_id[]": teamId }, "GET", uuid, token);
    const arr = data.data || data;
    results.basic = { count: Array.isArray(arr) ? arr.length : "not-array", raw: JSON.stringify(data).substring(0, 200) };
  } catch (e) { results.basic = { error: e.message }; }

  // 2: poule detail — matches are embedded in this response (not a separate /matches endpoint)
  if (pouleId) {
    try {
      const data = await hwRequest(`/poules/${pouleId}`, {}, "GET", uuid, token);
      const inner = data.data || data;
      const matchesArr = Array.isArray(inner.matches) ? inner.matches : [];
      const standingsArr = Array.isArray(inner.standings) ? inner.standings : [];

      // Find which team IDs in standings correspond to our club
      const ggStanding = standingsArr.find(s => {
        const n = (s.team?.name || "").toLowerCase();
        return n.includes("groen") || n.includes("geel") || n.includes("h8");
      });
      const ggTeamId = ggStanding?.team?.id;

      // Filter by team ID (preferred) or name — HW match structure uses m.home/m.away not m.home_team/m.away_team
      const ggMatches = matchesArr.filter(m =>
        m.home?.id === ggTeamId || m.away?.id === ggTeamId ||
        (m.home?.name || "").toLowerCase().includes("groen") ||
        (m.away?.name || "").toLowerCase().includes("groen")
      );
      // HW score is at m.score.home / m.score.away, not m.home_score
      const scoredGg = ggMatches.filter(m => m.score?.home !== null && m.score?.home !== undefined);

      results.poule_detail = {
        competition: inner.competition?.name,
        standings_count: standingsArr.length,
        gg_standing: ggStanding ? { rank: ggStanding.rank, team_id: ggStanding.team?.id, team_name: ggStanding.team?.name, played: ggStanding.played, points: ggStanding.points } : null,
        gg_team_id_in_poule: ggTeamId,
        matches_total: matchesArr.length,
        gg_matches: ggMatches.length,
        gg_scored: scoredGg.length,
        gg_match_sample: ggMatches.slice(0, 3),
        gg_scored_sample: scoredGg.slice(0, 3),
        all_matches_sample: matchesArr.slice(0, 2)
      };
    } catch (e) { results.poule_detail = { error: e.message }; }
  }

  // 4: explicit date range for past season (2025-2026)
  try {
    const data = await hwRequest("/matches/team", {
      "team_id[]": teamId,
      "date_from": "2025-08-01",
      "date_to": new Date().toISOString().substring(0, 10)
    }, "GET", uuid, token);
    const arr = data.data || data;
    results.date_range = { count: Array.isArray(arr) ? arr.length : "not-array", raw: JSON.stringify(data).substring(0, 300) };
  } catch (e) { results.date_range = { error: e.message }; }

  return { team_id: teamId, poule_id: pouleId, ...results };
}

// ---------- Clubi probe (1 HTTP fetch) ----------
async function handleProbeClubi(url) {
  const path = url.searchParams.get("path") || "/doc.html";
  const targetUrl = `${CLUBI_BASE}${path}`;
  try {
    const r = await fetch(targetUrl, {
      headers: { "Accept": "application/json, text/html", "User-Agent": "ho-krat-app/1.0" }
    });
    const ct = r.headers.get("content-type") || "";
    const body = await r.text();
    const limit = parseInt(url.searchParams.get("limit") || "5000");
    return json({
      url: targetUrl, status: r.status, content_type: ct,
      preview: body.substring(0, limit)
    });
  } catch (e) {
    return json({ url: targetUrl, error: e.message });
  }
}

// placeholder to satisfy old route reference — never reached now
async function handleProbe(env) {
  const out = { ts: new Date().toISOString(), knhb: {}, hw: {}, clubi: {} };

  // ── KNHB ────────────────────────────────────────────────────
  // Try several header combos because CloudFront sometimes blocks cloud IPs
  const knhbHeaderSets = [
    { "User-Agent": "ho-krat-app/1.0", "Accept": "application/json" },
    {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
      "Accept-Language": "nl-NL,nl;q=0.9",
      "Referer": "https://www.knhb.nl/"
    },
    {
      "User-Agent": "knhb-app/4.0 (Android)",
      "Accept": "application/json",
      "X-App-Version": "4.0.0"
    }
  ];

  let knhbClubs = null;
  let workingHeaders = null;
  for (const headers of knhbHeaderSets) {
    try {
      const r = await fetch(`${KNHB_MC}/clubs`, { headers });
      out.knhb.clubs_status = r.status;
      if (r.ok) {
        const d = await r.json();
        knhbClubs = d.data || d;
        out.knhb.clubs_count = Array.isArray(knhbClubs) ? knhbClubs.length : "not-array";
        workingHeaders = headers;
        break;
      } else {
        out.knhb[`clubs_err_${r.status}`] = (await r.text()).substring(0, 200);
      }
    } catch (e) {
      out.knhb.clubs_exception = e.message;
    }
  }

  if (Array.isArray(knhbClubs)) {
    const gg = knhbClubs.find(c => {
      const n = (c.name || "").toLowerCase().replace(/-/g, " ");
      return n.includes("groen") && n.includes("geel");
    });
    out.knhb.gg_club = gg || null;

    if (gg) {
      // Get all teams
      try {
        const tr = await fetch(`${KNHB_MC}/clubs/${gg.id}/teams`, { headers: workingHeaders });
        if (tr.ok) {
          const td = await tr.json();
          const teams = td.data || td;
          out.knhb.teams = Array.isArray(teams) ? teams.map(t => ({ id: t.id, name: t.name, short_name: t.short_name })) : teams;

          // Find H8
          const h8 = Array.isArray(teams) && teams.find(t => {
            const n = (t.name || t.short_name || "").toLowerCase().replace(/\s+/g, " ").trim();
            return n === "heren 8" || n === "h8" || n === "h 8" ||
              n.endsWith(" h8") || n.endsWith(" h 8") || n.endsWith(" heren 8") ||
              (n.includes("heren") && /\b8\b/.test(n));
          });
          out.knhb.h8_team = h8 || null;

          if (h8) {
            const tid = h8.id;
            // Test every plausible match endpoint
            const eps = [
              `teams/${tid}/matches/upcoming`,
              `teams/${tid}/matches/played`,
              `teams/${tid}/matches`,
              `teams/${tid}/schedule`,
              `teams/${tid}/results`,
              `teams/${tid}`,
            ];
            out.knhb.endpoints = {};
            for (const ep of eps) {
              try {
                const er = await fetch(`${KNHB_MC}/${ep}`, { headers: workingHeaders });
                if (er.ok) {
                  const ed = await er.json();
                  const arr = ed.data || ed.matches || (Array.isArray(ed) ? ed : null);
                  out.knhb.endpoints[ep] = {
                    status: er.status,
                    keys: Object.keys(ed),
                    count: Array.isArray(arr) ? arr.length : null,
                    // Include first 2 items raw so we can see fields
                    sample: Array.isArray(arr) ? arr.slice(0, 2) : ed
                  };
                } else {
                  out.knhb.endpoints[ep] = { status: er.status };
                }
              } catch (e) {
                out.knhb.endpoints[ep] = { error: e.message };
              }
            }
          }
        }
      } catch (e) {
        out.knhb.teams_error = e.message;
      }
    }
  }

  // ── HockeyWeerelt (app.hockeyweerelt.nl) ────────────────────
  try {
    const { uuid, token } = await hwGetOrCreateDevice(env);
    out.hw.device = { uuid_preview: uuid.substring(0, 8) + "...", has_token: !!token };

    // Get clubs
    const clubsData = await hwRequest("/clubs", {}, "GET", uuid, token);
    const clubs = clubsData.data || clubsData;
    out.hw.clubs_count = Array.isArray(clubs) ? clubs.length : typeof clubs;

    const gg = Array.isArray(clubs) && clubs.find(c => {
      const n = (c.name || "").toLowerCase().replace(/-/g, " ");
      return n.includes("groen") && n.includes("geel");
    });
    out.hw.gg_club = gg ? { id: gg.id, name: gg.name, ref: gg.federation_reference_id } : null;

    if (gg) {
      const clubRef = gg.federation_reference_id || gg.id;
      const clubData = await hwRequest(`/clubs/${clubRef}`, {}, "GET", uuid, token);
      const teamList = clubData.data?.teams || clubData.teams ||
        (Array.isArray(clubData.data) ? clubData.data : null) || [];
      out.hw.teams = Array.isArray(teamList)
        ? teamList.map(t => ({ id: t.id, name: t.name, short_name: t.short_name }))
        : "not-array";

      const h8 = Array.isArray(teamList) && teamList.find(t => {
        const short = (t.short_name || "").toLowerCase().trim();
        const full = (t.name || t.full_name || "").toLowerCase();
        return short === "h8" || short === "8" || full.includes("heren 8") || full === "h8";
      });
      out.hw.h8_team = h8 ? { id: h8.id, name: h8.name, short_name: h8.short_name } : null;

      if (h8) {
        const tid = String(h8.id);
        // Test match endpoints with various status filters
        const matchEndpoints = [
          { path: "/matches/team", params: { "team_id[]": tid } },
          { path: "/matches/team", params: { "team_id[]": tid, "status[]": "played" } },
          { path: "/matches/team", params: { "team_id[]": tid, "status[]": "official" } },
          { path: "/matches/team", params: { "team_id[]": tid, "status[]": "finished" } },
          { path: `/teams/${tid}/matches`, params: {} },
          { path: `/teams/${tid}/matches/played`, params: {} },
        ];
        out.hw.match_endpoints = {};
        for (const { path, params } of matchEndpoints) {
          const key = path + (Object.keys(params).length ? "?" + new URLSearchParams(params).toString() : "");
          try {
            const mr = await hwRequest(path, params, "GET", uuid, token);
            const arr = mr.data || mr;
            const matches = Array.isArray(arr) ? arr : null;
            const played = matches ? matches.filter(m =>
              m.status && !["scheduled", "announced"].includes(m.status)
            ) : null;
            out.hw.match_endpoints[key] = {
              total: matches ? matches.length : null,
              played_count: played ? played.length : null,
              statuses: matches ? [...new Set(matches.map(m => m.status))] : null,
              sample_played: played ? played.slice(0, 2) : null,
              sample_raw: matches ? matches.slice(0, 1) : null,
              raw_keys: mr ? Object.keys(mr) : null
            };
          } catch (e) {
            out.hw.match_endpoints[key] = { error: e.message };
          }
        }
      }
    }
  } catch (e) {
    out.hw.error = e.message;
  }

  // ── clubi.hockeyweerelt.nl ───────────────────────────────────
  const clubiPaths = [
    "/",
    "/api",
    "/api/v1",
    "/clubs",
    "/api/clubs",
    "/graphql",
    "/doc.html",
    "/swagger.json",
    "/openapi.json",
    "/api/v1/clubs",
    "/api/v1/teams",
    "/api/v1/matches",
  ];
  out.clubi = {};
  for (const p of clubiPaths) {
    try {
      const r = await fetch(`${CLUBI_BASE}${p}`, {
        headers: { "Accept": "application/json, text/html", "User-Agent": "ho-krat-app/1.0" }
      });
      if (r.ok) {
        const ct = r.headers.get("content-type") || "";
        if (ct.includes("json")) {
          const d = await r.json();
          out.clubi[p] = { status: r.status, type: "json", keys: Object.keys(d), preview: JSON.stringify(d).substring(0, 300) };
        } else {
          const t = await r.text();
          out.clubi[p] = { status: r.status, type: ct, preview: t.substring(0, 300) };
        }
      } else {
        out.clubi[p] = { status: r.status };
      }
    } catch (e) {
      out.clubi[p] = { error: e.message };
    }
  }

  return json(out);
}

function enrichWithKnhb(event, knhbMatches) {
  if (!knhbMatches || !event || event.type !== "wedstrijd") return event;

  const eventDateStr = (event.startTimestamp || "").substring(0, 10);
  if (!eventDateStr) return event;

  // Match by calendar date — KNHB datetime is NL local, Spond is UTC.
  // For matches that aren't near midnight, the date string is the same.
  const match = knhbMatches.find(m => (m.datetime || "").substring(0, 10) === eventDateStr);
  if (!match) return event;

  // Convert KNHB NL local datetime to UTC for the countdown.
  // NL: UTC+1 (winter) / UTC+2 (summer, March–October).
  let knhbStartUtc = event.startTimestamp;
  if (match.datetime) {
    const month = parseInt(match.datetime.substring(5, 7), 10);
    const offsetMs = (month >= 3 && month <= 10 ? 2 : 1) * 3600000;
    const asUtc = new Date(match.datetime + "Z");
    knhbStartUtc = new Date(asUtc.getTime() - offsetMs).toISOString();
  }

  return {
    ...event,
    startTimestamp: knhbStartUtc,
    knhbDateTime: match.datetime || null,
    knhbLocation: match.location || null,
    knhbHomeTeam: match.home_team?.name || null,
    knhbAwayTeam: match.away_team?.name || null,
    knhbField: match.field || null,
  };
}
