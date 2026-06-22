const TARGET_GROUP_NAME = "Groen Geel - H8";
const API_BASE_URL = "https://api.spond.com/core/v1/";
const KNHB_MC = "https://publicaties.hockeyweerelt.nl/mc";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

    // Go back 2 full seasons worth of events
    const twoSeasonsBack = new Date(now);
    twoSeasonsBack.setFullYear(twoSeasonsBack.getFullYear() - 2);
    const minTs = twoSeasonsBack.toISOString();
    const maxTs = now.toISOString();

    // Try the explicit past-event query first, fall back to the generic one
    let events = [];
    try {
      events = await spondGet(
        `sponds/?max=200&minEndTimestamp=${minTs}&maxEndTimestamp=${maxTs}&scheduled=false`,
        token
      );
    } catch {
      // If the API doesn't support those params, fall back and filter manually
      try {
        events = await spondGet("sponds/?max=200&scheduled=false", token);
      } catch {
        events = [];
      }
    }

    if (!Array.isArray(events)) events = [];

    // Keep only past wedstrijden
    const pastMatches = events
      .filter(e => {
        if (!e.startTimestamp) return false;
        if (new Date(e.startTimestamp) >= now) return false;
        const name = String(e.heading || "").toLowerCase();
        return name.includes("thuis") || name.includes("uit");
      })
      .sort((a, b) => new Date(b.startTimestamp) - new Date(a.startTimestamp))
      .slice(0, 60);

    if (!pastMatches.length) {
      return json({ matches: [] });
    }

    // Try to get KNHB played/all matches for opponent enrichment
    const knhbMatches = await fetchKnhbPlayedMatches(env);

    const formatted = pastMatches.map(e => {
      const date = e.startTimestamp.substring(0, 10);
      const heading = String(e.heading || "");
      const isHome = heading.toLowerCase().includes("thuis");

      // Try KNHB enrichment for opponent name
      let opponent = "";
      if (knhbMatches) {
        const km = knhbMatches.find(m => {
          const kDate = (m.datetime || "").substring(0, 10);
          return kDate === date;
        });
        if (km) {
          const homeName = km.home_team?.name || "";
          const awayName = km.away_team?.name || "";
          const isOurHome = homeName.toLowerCase().includes("groen") || homeName.toLowerCase().includes("geel");
          opponent = isOurHome ? awayName : homeName;
        }
      }

      // If no KNHB match, try extracting from the heading
      // Headings like "Thuis: GG H8 - Kampong H7" or "Uit bij Zwolle"
      if (!opponent) {
        const lower = heading.toLowerCase();
        const afterColon = heading.includes(":") ? heading.split(":").slice(1).join(":").trim() : "";
        if (afterColon) {
          // "GG H8 - Opponent" or "Opponent - GG H8"
          const parts = afterColon.split(/\s*[-–]\s*/);
          if (parts.length >= 2) {
            const isFirstOurs = parts[0].toLowerCase().includes("groen") ||
              parts[0].toLowerCase().includes("geel") ||
              parts[0].toLowerCase().includes("gg ");
            opponent = isFirstOurs ? parts[1].trim() : parts[0].trim();
          }
        } else if (lower.includes("bij ")) {
          opponent = heading.substring(lower.indexOf("bij ") + 4).trim();
        } else if (lower.includes("vs ")) {
          const vsParts = heading.substring(lower.indexOf("vs ") + 3).split(/\s*[-–]\s*/);
          opponent = vsParts[0].trim();
        }
      }

      return {
        id: e.id,
        date,
        heading,
        isHome,
        opponent
      };
    });

    return json({ matches: formatted });
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
      const n = (t.name || t.short_name || "").toLowerCase().trim().replace(/\s+/g, " ");
      return n === "heren 8" || n.endsWith(" h8") || n === "h 8";
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
