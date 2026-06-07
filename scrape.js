const https = require("https");
const fs = require("fs");

const URL = "https://www.groengeel.nl/index.php?page=Heren8&sid=1";

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "text/html"
          }
        },
        (res) => {
          let data = "";

          console.log("STATUS:", res.statusCode);

          res.on("data", (chunk) => {
            data += chunk;
          });

          res.on("end", () => {
            resolve(data);
          });
        }
      )
      .on("error", reject);
  });
}

function clean(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDateAmsterdam() {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  })
    .format(new Date())
    .replaceAll("/", "-");
}

(async () => {
  const html = await fetchUrl(URL);
  const today = formatDateAmsterdam();

  fs.writeFileSync("debug_full_page.html", html);

  let matchToday = false;
  let nextMatch = null;
  let position = null;

  const debug = {
    lastUpdated: new Date().toISOString(),
    htmlLength: html.length,
    today,
    contains: {
      H8: html.includes("H8"),
      Heren8: html.includes("Heren 8"),
      LeidenH7: html.includes("Leiden H7"),
      Wedstrijdschema: html.includes("Wedstrijdschema"),
      tableRowMyTeam: html.includes("table-row--my-team"),
      GroenGeelH8: html.includes("Groen-Geel H8")
    },
    indexes: {
      H8: html.indexOf("H8"),
      Heren8: html.indexOf("Heren 8"),
      LeidenH7: html.indexOf("Leiden H7"),
      Wedstrijdschema: html.indexOf("Wedstrijdschema"),
      tableRowMyTeam: html.indexOf("table-row--my-team"),
      GroenGeelH8: html.indexOf("Groen-Geel H8")
    },
    snippets: {}
  };

  function addSnippet(key, search) {
    const i = html.indexOf(search);
    if (i === -1) {
      debug.snippets[key] = null;
      return;
    }

    debug.snippets[key] = html.slice(
      Math.max(0, i - 1000),
      Math.min(html.length, i + 2500)
    );
  }

  addSnippet("wedstrijdschema", "Wedstrijdschema");
  addSnippet("h8", "H8");
  addSnippet("leidenH7", "Leiden H7");
  addSnippet("tableRowMyTeam", "table-row--my-team");
  addSnippet("groenGeelH8", "Groen-Geel H8");

  const scheduleStart = html.indexOf("Wedstrijdschema");
  const scheduleHtml =
    scheduleStart >= 0
      ? html.slice(scheduleStart, scheduleStart + 20000)
      : html;

  const eventRegex =
    /<div class="game-schedule-event[\s\S]*?(?=<div class="game-schedule-event|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>)/g;

  const events = scheduleHtml.match(eventRegex) || [];

  debug.eventsFound = events.length;
  debug.eventSummaries = [];

  for (const event of events) {
    const home = clean(
      (event.match(/<div class="home-team">\s*([\s\S]*?)<\/div>/i) || [])[1]
    );

    const away = clean(
      (event.match(/<div class="away-team">\s*([\s\S]*?)<\/div>/i) || [])[1]
    );

    const date = clean(
      (event.match(/<span class="date">\s*([\s\S]*?)<\/span>/i) || [])[1]
    );

    const timeMatch = event.match(/<\/span>\s*([0-9]{2}:[0-9]{2})/);
    const time = timeMatch ? timeMatch[1] : null;

    debug.eventSummaries.push({ home, away, date, time });

    if (home === "H8" || away === "H8") {
      nextMatch = {
        opponent: home === "H8" ? away : home,
        date,
        time,
        home: home === "H8"
      };

      matchToday = date === today;
      break;
    }
  }

  const positionRegex =
    /<tr class="table-row--my-team">[\s\S]*?<span[^>]*>\s*([0-9]+)\./i;

  const positionMatch = html.match(positionRegex);

  if (positionMatch) {
    position = parseInt(positionMatch[1], 10);
  }

  const output = {
    lastUpdated: new Date().toISOString(),
    team: "Heren 8",
    matchToday,
    position,
    nextMatch
  };

  fs.writeFileSync("wedstrijd.json", JSON.stringify(output, null, 2));
  fs.writeFileSync("debug_scrape.json", JSON.stringify(debug, null, 2));

  console.log("OUTPUT:");
  console.log(JSON.stringify(output, null, 2));

  console.log("DEBUG:");
  console.log(JSON.stringify(debug, null, 2));
})();