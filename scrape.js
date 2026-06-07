const https = require("https");
const fs = require("fs");

const URL =
  "https://www.groengeel.nl/index.php?page=Heren8&sid=1";

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        resolve(data);
      });

    }).on("error", reject);
  });
}

function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();

  return `${dd}-${mm}-${yyyy}`;
}

(async () => {

  const html = await fetch(URL);

  const today = formatDate(new Date());

  const matchRegex =
    /<div class="home-team">\s*H8\s*<\/div>[\s\S]*?<span class="date">\s*([0-9]{2}-[0-9]{2}-[0-9]{4})[\s\S]*?<\/span>\s*([0-9]{2}:[0-9]{2})/;

  const match = html.match(matchRegex);

  let matchToday = false;
  let nextMatch = null;

  if (match) {

    nextMatch = {
      date: match[1],
      time: match[2]
    };

    matchToday = match[1] === today;
  }

  const output = {
    lastUpdated: new Date().toISOString(),
    team: "Heren 8",
    matchToday,
    nextMatch
  };

  fs.writeFileSync(
    "wedstrijd.json",
    JSON.stringify(output, null, 2)
  );

  console.log(output);

})();