const TARGET_GROUP_NAME = "Groen Geel - H8";
const API_BASE_URL = "https://api.spond.com/core/v1/";
const KNHB_MC = "https://publicaties.hockeyweerelt.nl/mc";

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

    // Try to get KNHB played/all matches for opponent enrichment
    const knhbMatches = await fetchKnhbPlayedMatches(env);

    const formatted = pastMatches.map(e => {
      const date = e.startTimestamp.substring(0, 10);
      const heading = String(e.heading || "");
      const subHeading = String(e.subHeading || "");
      const description = String(e.description || "");
      const lower = heading.toLowerCase();
      const isHome = lower.includes("thuis");

      let opponent = "";
      let goalsFor = null;
      let goalsAgainst = null;

      // --- KNHB enrichment (score + opponent) ---
      if (knhbMatches) {
        // Try several date field names the KNHB API may use
        const km = knhbMatches.find(m => {
          const dt = m.datetime || m.date || m.start_date || m.match_date || m.startTimestamp || "";
          return String(dt).substring(0, 10) === date;
        });
        if (km) {
          const homeName = km.home_team?.name || km.home?.name || km.home_club?.name || "";
          const awayName = km.away_team?.name || km.away?.name || km.away_club?.name || "";
          const isOurHome = homeName.toLowerCase().includes("groen") ||
            homeName.toLowerCase().includes("geel");
          opponent = isOurHome ? awayName : homeName;
          const hs = km.home_score ?? km.score?.home ?? km.result?.home ?? null;
          const as_ = km.away_score ?? km.score?.away ?? km.result?.away ?? null;
          if (hs !== null && as_ !== null) {
            goalsFor = isOurHome ? Number(hs) : Number(as_);
            goalsAgainst = isOurHome ? Number(as_) : Number(hs);
          }
        }
      }

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

    return json({ matches: formatted, debug: { strategy: debugStrategy, totalEvents: events.length } });
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
