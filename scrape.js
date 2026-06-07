const https = require("https");
const fs = require("fs");

const URL = "https://www.groengeel.nl/index.php?page=Heren8&sid=1";

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(
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
        console.log("HEADERS:", res.headers);

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          resolve(data);
        });
      }
    ).on("error", reject);
  });
}

function clean(s) {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

(async () => {
  const html = await fetchUrl(URL);

  fs.writeFileSync("debug_full_page.html", html);

  const debug = {
    length: html.length,
    hasHeren8Title: html.includes("Heren 8"),
    hasWedstrijdschema: html.includes("Wedstrijdschema"),
    hasH8: html.includes("H8"),
    hasLeiden: html.includes("Leiden H7"),
    hasTableRowMyTeam: html.includes("table-row--my-team"),
    first1000: html.slice(0, 1000),
    heren8Index: html.indexOf("Heren 8"),
    wedstrijdschemaIndex: html.indexOf("Wedstrijdschema"),
    h8Index: html.indexOf("H8"),
    leidenIndex: html.indexOf("Leiden H7"),
    tableRowIndex: html.indexOf("table-row--my-team")
  };

  function snippetAround(search, name) {
    const i = html.indexOf(search);
    if (i === -1) return null;

    return {
      name,
      index: i,
      snippet: html.slice(Math.max(0, i - 800), i + 1600)
    };
  }

  debug.snippets = [
    snippetAround("Wedstrijdschema", "Wedstrijdschema"),
    snippetAround("H8", "H8"),
    snippetAround("Leiden H7", "Leiden H7"),
    snippetAround("table-row--my-team", "table-row--my-team"),
    snippetAround("Groen-Geel H8", "Groen-Geel H8")
  ];

  fs.writeFileSync(
    "debug_scrape.json",
    JSON.stringify(debug, null, 2)
  );

  console.log(JSON.stringify(debug, null, 2));
})();