const https = require("https");
const fs = require("fs");

const URL = "https://www.groengeel.nl/index.php?page=Heren8&sid=1";

https.get(URL, {
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Accept": "text/html",
    "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8"
  }
}, (res) => {
  let data = "";

  res.on("data", chunk => data += chunk);

  res.on("end", () => {
    const debug = {
      statusCode: res.statusCode,
      headers: res.headers,
      htmlLength: data.length,
      fullHtml: data
    };

    fs.writeFileSync("debug_scrape.json", JSON.stringify(debug, null, 2));
    fs.writeFileSync("debug_full_page.html", data);

    console.log(JSON.stringify(debug, null, 2));
  });
});