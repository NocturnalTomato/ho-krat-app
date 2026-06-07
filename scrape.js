const https = require("https");
const fs = require("fs");

const URL = "https://www.groengeel.nl/index.php?page=Heren8&sid=1";

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function todayNL() {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date()).replaceAll("/", "-");
}

function clean(s) {
  return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

(async () => {
  const html = await fetchUrl(URL);
  const today = todayNL();

  let matchToday = false;
  let nextMatch = null;
  let position = null;

  const scheduleMatch = html.match(/<h4[^>]*>\s*Wedstrijdschema\s*<\/h4>[\s\S]*?(<div class="game-schedule-event[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>)/i);

  if (scheduleMatch) {
    const block = scheduleMatch[1];

    const home = clean((block.match(/<div class="home-team">\s*([\s\S]*?)<\/div>/i) || [])[1] || "");
    const away = clean((block.match(/<div class="away-team">\s*([\s\S]*?)<\/div>/i) || [])[1] || "");
    const date = clean((block.match(/<span class="date">\s*([\s\S]*?)<\/span>/i) || [])[1] || "");
    const timeMatch = block.match(/<\/span>\s*([0-9]{2}:[0-9]{2})/);
    const time = timeMatch ? timeMatch[1] : null;

    if (home === "H8" || away === "H8") {
      nextMatch = {
        opponent: home === "H8" ? away : home,
        date,
        time,
        home: home === "H8"
      };

      matchToday = date === today;
    }
  }

  const posMatch = html.match(/<tr class="table-row--my-team">[\s\S]*?<span[^>]*>\s*([0-9]+)\./i);
  if (posMatch) {
    position = parseInt(posMatch[1], 10);
  }

  const output = {
    lastUpdated: new Date().toISOString(),
    team: "Heren 8",
    matchToday,
    position,
    nextMatch
  };

  fs.writeFileSync("wedstrijd.json", JSON.stringify(output, null, 2));
  console.log(output);
})();