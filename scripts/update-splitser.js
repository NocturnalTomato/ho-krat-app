const LIST_ID = "ccb30c39-6895-41d8-b90b-3486fd022f79";

async function main() {
  const email = process.env.SPLITSER_EMAIL;
  const password = process.env.SPLITSER_PASSWORD;

  if (!email || !password) {
    throw new Error("Missing SPLITSER_EMAIL or SPLITSER_PASSWORD");
  }

  console.log("Logging into Splitser...");

  const loginResponse = await fetch(
    "https://api2.wiebetaaltwat.nl/api/users/sign_in",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Version": "4",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user: {
          email,
          password,
        },
      }),
    }
  );

  if (!loginResponse.ok) {
    throw new Error(`Login failed: ${loginResponse.status}`);
  }

  const setCookie = loginResponse.headers.get("set-cookie");

  const match = setCookie?.match(/_wbw_rails_session=([^;]+)/);

  if (!match) {
    throw new Error("Could not find session cookie");
  }

  const cookie = match[1];

  console.log("Fetching balance...");

  const balanceResponse = await fetch(
    `https://api2.wiebetaaltwat.nl/api/lists/${LIST_ID}/balance`,
    {
      headers: {
        Accept: "application/json",
        "Accept-Version": "4",
        Cookie: `_wbw_rails_session=${cookie}`,
      },
    }
  );

  if (!balanceResponse.ok) {
    throw new Error(`Balance failed: ${balanceResponse.status}`);
  }

  const data = await balanceResponse.json();

  const people = data.balance.member_totals.map((x) => ({
    name: x.member_total.member.nickname,
    fullName: x.member_total.member.full_name,
    amount: x.member_total.balance_total.formatted,
    amountCents: x.member_total.balance_total.fractional,
    isCurrent: x.member_total.member.is_current,
  }));

  const fs = await import("fs");

  fs.writeFileSync(
    "splitser-overzicht.json",
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        people,
      },
      null,
      2
    )
  );

  console.log("splitser-overzicht.json updated");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
