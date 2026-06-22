#!/usr/bin/env node
// Fetches upcoming match data for Groen Geel H8 from the KNHB public API
// and writes the result to wedstrijd.json.
// Requires Node 18+ (global fetch).

const fs = require("fs");
const path = require("path");

const KNHB_MC = "https://publicaties.hockeyweerelt.nl/mc";
const OUT_PATH = path.join(__dirname, "wedstrijd.json");
const DEBUG_PATH = path.join(__dirname, "debug_scrape.json");

async function findTeamId() {
  const clubsRes = await fetch(`${KNHB_MC}/clubs`, {
    headers: { "User-Agent": "ho-krat-scraper/1.0", "Accept": "application/json" }
  });
  if (!clubsRes.ok) throw new Error(`Clubs endpoint returned ${clubsRes.status}`);
  const clubs = (await clubsRes.json()).data || [];

  const club = clubs.find(c => {
    const n = (c.name || "").toLowerCase().replace(/-/g, " ");
    return n.includes("groen") && n.includes("geel");
  });
  if (!club) throw new Error(`Groen Geel not found. Available: ${clubs.map(c => c.name).join(", ")}`);
  console.log(`Club: ${club.name} (id: ${club.id})`);

  const teamsRes = await fetch(`${KNHB_MC}/clubs/${club.id}/teams`, {
    headers: { "User-Agent": "ho-krat-scraper/1.0", "Accept": "application/json" }
  });
  if (!teamsRes.ok) throw new Error(`Teams endpoint returned ${teamsRes.status}`);
  const teams = (await teamsRes.json()).data || [];

  const team = teams.find(t => {
    const n = (t.name || t.short_name || "").toLowerCase().trim().replace(/\s+/g, " ");
    return n === "heren 8" || n.endsWith(" h8") || n === "h 8";
  });
  if (!team) throw new Error(`Heren 8 not found. Available: ${teams.map(t => t.name).join(", ")}`);
  console.log(`Team: ${team.name} (id: ${team.id})`);

  return String(team.id);
}

async function fetchMatches(teamId) {
  const res = await fetch(`${KNHB_MC}/teams/${teamId}/matches/upcoming`, {
    headers: { "User-Agent": "ho-krat-scraper/1.0", "Accept": "application/json" }
  });
  if (!res.ok) throw new Error(`Matches endpoint returned ${res.status}`);
  return (await res.json()).data || [];
}

async function main() {
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(OUT_PATH, "utf8")); } catch {}

  let teamId = existing.teamId || null;
  let debugInfo = {};

  try {
    if (!teamId) teamId = await findTeamId();
    const matches = await fetchMatches(teamId);
    debugInfo = { teamId, matchCount: matches.length };

    const now = new Date();
    const todayStr = now.toISOString().substring(0, 10);
    const upcoming = matches
      .filter(m => m.datetime && m.datetime.substring(0, 10) >= todayStr)
      .sort((a, b) => a.datetime.localeCompare(b.datetime));

    const toMatchData = m => m ? {
      datetime: m.datetime,
      homeTeam: m.home_team?.name || null,
      awayTeam: m.away_team?.name || null,
      location: m.location || null,
      field: m.field || null,
      competition: m.competition?.name || null,
    } : null;

    const output = {
      lastUpdated: now.toISOString(),
      team: "Heren 8",
      teamId,
      matchToday: upcoming.some(m => m.datetime?.substring(0, 10) === todayStr),
      nextMatch: toMatchData(upcoming[0]),
      matchAfter: toMatchData(upcoming[1]),
    };

    fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
    fs.writeFileSync(DEBUG_PATH, JSON.stringify({ success: true, ...debugInfo }, null, 2));
    console.log("wedstrijd.json updated. Next match:", output.nextMatch?.datetime ?? "none");
  } catch (err) {
    console.error("Scrape failed:", err.message);
    fs.writeFileSync(DEBUG_PATH, JSON.stringify({ success: false, error: err.message, ...debugInfo }, null, 2));
    process.exit(1);
  }
}

main();
