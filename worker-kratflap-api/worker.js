const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key"
};

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: { ...corsHeaders, ...(init.headers || {}) }
  });
}

function getWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function cleanName(value) {
  return String(value || "")
    .trim()
    .replace(/[^\p{L}\p{N}_\- ]/gu, "")
    .slice(0, 10) || "Anoniem";
}

function cleanScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  // Cap at 500 — far above any realistic game score (~20-25 is typical)
  return Math.max(0, Math.min(500, Math.floor(score)));
}

function randomToken() {
  const arr = new Uint8Array(20);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
}

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // GET /session — issue a one-time game session token
    if (url.pathname === "/session" && request.method === "GET") {
      const token = randomToken();
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO sessions (token, created_at, used) VALUES (?, ?, 0)`
      ).bind(token, now).run();

      // Clean up expired sessions (fire and forget)
      env.DB.prepare(
        `DELETE FROM sessions WHERE created_at < datetime('now', '-1 hour')`
      ).run().catch(() => {});

      return json({ token });
    }

    // GET /scores — fetch leaderboards (no auth needed)
    if (url.pathname === "/scores" && request.method === "GET") {
      const weekKey = getWeekKey();

      const [allTimeTop, weekTop, weekWorst] = await Promise.all([
        env.DB.prepare(
          `SELECT name, score, created_at FROM scores ORDER BY score DESC, created_at ASC LIMIT 5`
        ).all(),
        env.DB.prepare(
          `SELECT name, score, created_at FROM scores WHERE week_key = ? ORDER BY score DESC, created_at ASC LIMIT 5`
        ).bind(weekKey).all(),
        env.DB.prepare(
          `SELECT name, score, created_at FROM scores WHERE week_key = ? ORDER BY score ASC, created_at ASC LIMIT 1`
        ).bind(weekKey).first()
      ]);

      return json({
        success: true,
        weekKey,
        allTimeTop: allTimeTop.results || [],
        weekTop: weekTop.results || [],
        weekWorst: weekWorst || null
      });
    }

    // POST /scores — submit a score (requires valid one-time session token)
    if (url.pathname === "/scores" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ success: false, error: "Invalid JSON" }, { status: 400 });
      }

      const token = String(body.token || "").trim();
      if (!token) {
        return json({ success: false, error: "Missing session token" }, { status: 401 });
      }

      const session = await env.DB.prepare(
        `SELECT token, created_at, used FROM sessions WHERE token = ?`
      ).bind(token).first();

      if (!session) {
        return json({ success: false, error: "Invalid session token" }, { status: 401 });
      }
      if (session.used) {
        return json({ success: false, error: "Session token already used" }, { status: 401 });
      }
      if (Date.now() - new Date(session.created_at).getTime() > SESSION_TTL_MS) {
        return json({ success: false, error: "Session token expired" }, { status: 401 });
      }

      // Mark token used before inserting score (prevent race-condition double-submit)
      await env.DB.prepare(`UPDATE sessions SET used = 1 WHERE token = ?`).bind(token).run();

      const name = cleanName(body.name);
      const score = cleanScore(body.score);
      const now = new Date().toISOString();
      const weekKey = getWeekKey(new Date(now));

      await env.DB.prepare(
        `INSERT INTO scores (name, score, created_at, week_key) VALUES (?, ?, ?, ?)`
      ).bind(name, score, now, weekKey).run();

      return json({ success: true, saved: { name, score, created_at: now, week_key: weekKey } });
    }

    // DELETE /scores?id=X — admin removal of a score (requires X-Admin-Key header)
    if (url.pathname === "/scores" && request.method === "DELETE") {
      const adminKey = request.headers.get("X-Admin-Key");
      if (!adminKey || adminKey !== env.ADMIN_KEY) {
        return json({ success: false, error: "Unauthorized" }, { status: 401 });
      }
      const id = url.searchParams.get("id");
      if (!id) {
        return json({ success: false, error: "Missing id parameter" }, { status: 400 });
      }
      await env.DB.prepare(`DELETE FROM scores WHERE id = ?`).bind(id).run();
      return json({ success: true });
    }

    return json({ success: false, error: "Not found" }, { status: 404 });
  }
};
