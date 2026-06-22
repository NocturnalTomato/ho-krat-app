const TARGET_GROUP_NAME = "Groen Geel - H8";
const API_BASE_URL = "https://api.spond.com/core/v1/";

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

    if (url.pathname !== "/" && url.pathname !== "/spond") {
      return json(
        {
          success: false,
          error: "Unknown endpoint",
          endpoints: ["/", "/spond", "/lineup"]
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
  if (!env.LINEUP_KV) {
    return json({ formation: "4-3-3", positions: {}, extraPlayers: [] });
  }

  const raw = await env.LINEUP_KV.get("current");

  if (!raw) {
    return json({ formation: "4-3-3", positions: {}, extraPlayers: [] });
  }

  try {
    return json(JSON.parse(raw));
  } catch {
    return json({ formation: "4-3-3", positions: {}, extraPlayers: [] });
  }
}

async function handleLineupPost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Ongeldige JSON" }, { status: 400 });
  }

  const { password, formation, positions, extraPlayers } = body;

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
    updatedAt: new Date().toISOString()
  };

  await env.LINEUP_KV.put("current", JSON.stringify(data));

  return json({ success: true });
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

  const nextEvent = relevantEvents[0] || null;

  const output = {
    updatedAt: now.toISOString(),
    team: TARGET_GROUP_NAME,
    groupId: targetGroup?.id || null,
    memberCount: Array.isArray(targetGroup?.members) ? targetGroup.members.length : null,
    upcomingEvent: null
  };

  if (nextEvent) {
    output.upcomingEvent = {
      id: nextEvent.id,
      name: nextEvent.heading,
      startTimestamp: nextEvent.startTimestamp,
      endTimestamp: nextEvent.endTimestamp,
      location: nextEvent.location || null,
      type: getEventType(nextEvent),
      ...extractAttendance(nextEvent, memberLookup)
    };
  }

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
