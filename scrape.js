export default {
  async fetch(request) {
    const url = "https://www.groengeel.nl/index.php?page=Heren8&sid=1";

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html",
        "Accept-Language": "nl-NL,nl;q=0.9"
      }
    });

    const html = await response.text();

    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "access-control-allow-origin": "*"
      }
    });
  }
};