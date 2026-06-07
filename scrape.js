const homeRegex =
  /<div class="game-schedule-event[\s\S]*?<div class="home-team">\s*H8\s*<\/div>[\s\S]*?<div class="away-team">\s*([^<]+?)\s*<\/div>[\s\S]*?<span class="date">\s*([0-9]{2}-[0-9]{2}-[0-9]{4})[\s\S]*?<\/span>\s*([0-9]{2}:[0-9]{2})/;

const awayRegex =
  /<div class="game-schedule-event[\s\S]*?<div class="home-team">\s*([^<]+?)\s*<\/div>[\s\S]*?<div class="away-team">\s*H8\s*<\/div>[\s\S]*?<span class="date">\s*([0-9]{2}-[0-9]{2}-[0-9]{4})[\s\S]*?<\/span>\s*([0-9]{2}:[0-9]{2})/;

let match = html.match(homeRegex);
let homeGame = true;

if (!match) {
  match = html.match(awayRegex);
  homeGame = false;
}

if (match) {

  nextMatch = {
    opponent: match[1].trim(),
    date: match[2],
    time: match[3],
    home: homeGame
  };

  matchToday = match[2] === today;
}