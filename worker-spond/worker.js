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

    if (url.pathname === "/probe") {
      if (request.method === "GET") return handleProbe(env);
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

  const relevantEvents = events
    .filter(event => {
      if (!event.startTimestamp) return false;
      const start = new Date(event.startTimestamp);
      return start > now && isRelevantEvent(event);
    })
    .sort((a, b) => new Date(a.startTimestamp) - new Date(b.startTimestamp));

  const firstEvent = relevantEvents[0] || null;
  const secondEvent = relevantEvents[1] || null;

  const output = {
    updatedAt: now.toISOString(),
    team: TARGET_GROUP_NAME,
    groupId: targetGroup?.id || null,
    memberCount: Array.isArray(targetGroup?.members) ? targetGroup.members.length : null,
    members: Object.values(memberLookup).sort(),
    upcomingEvent: null,
    nextEvent: null
  };

  if (firstEvent) {
    output.upcomingEvent = {
      id: firstEvent.id,
      name: firstEvent.heading,
      startTimestamp: firstEvent.startTimestamp,
      endTimestamp: firstEvent.endTimestamp,
      location: firstEvent.location || null,
      type: getEventType(firstEvent),
      ...extractAttendance(firstEvent, memberLookup)
    };
  }

  if (secondEvent) {
    output.nextEvent = {
      id: secondEvent.id,
      name: secondEvent.heading,
      startTimestamp: secondEvent.startTimestamp,
      endTimestamp: secondEvent.endTimestamp,
      location: secondEvent.location || null,
      type: getEventType(secondEvent),
      ...extractAttendance(secondEvent, memberLookup)
    };
  }

  const knhbMatches = await fetchKnhbData(env);
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
   PROBE — exhaustive API discovery for match scores
   GET /probe  →  raw results from every hockey data source
============================================================ */

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
