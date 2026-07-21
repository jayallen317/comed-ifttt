#!/usr/bin/env node
/**
 * ComEd hourly-pricing -> IFTTT bridge.
 *
 * Fetches the current ComEd 5-minute price, compares it to a day/night
 * threshold in America/Chicago time, and fires an IFTTT webhook event
 * ONLY when the high/low state changes from the previous run.
 *
 * State is persisted to state.json, which the GitHub Actions workflow
 * commits back to the repo between runs.
 */

const fs = require("fs");
const path = require("path");

// ---- Config -------------------------------------------------------------

const DAY_START_HOUR = 6; // 6am Chicago
const DAY_END_HOUR = 22; // 10pm Chicago
const DAY_THRESHOLD = 5.0; // cents/kWh
const NIGHT_THRESHOLD = 3.0; // cents/kWh

const FEED_URL = "https://hourlypricing.comed.com/api?type=5minutefeed";
const STATE_FILE = path.join(__dirname, "state.json");

const IFTTT_KEY = process.env.IFTTT_KEY;
if (!IFTTT_KEY) {
  console.error("Missing IFTTT_KEY environment variable.");
  process.exit(1);
}

// ---- Helpers ------------------------------------------------------------

function chicagoHour(date) {
  // Intl gives us the correct hour with DST handled for us.
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    hour12: false,
  }).format(date);
  return parseInt(hour, 10) % 24;
}

function thresholdFor(date) {
  const h = chicagoHour(date);
  const isDay = h >= DAY_START_HOUR && h < DAY_END_HOUR;
  return { isDay, threshold: isDay ? DAY_THRESHOLD : NIGHT_THRESHOLD };
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { state: null };
  }
}

function writeState(next) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + "\n");
}

async function fetchCurrentPrice() {
  const res = await fetch(FEED_URL, {
    headers: { "User-Agent": "comed-ifttt-bridge" },
  });
  if (!res.ok) {
    throw new Error(`ComEd feed returned HTTP ${res.status}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("ComEd feed returned no data");
  }
  // The feed is newest-first, but sort defensively rather than trusting order.
  rows.sort((a, b) => Number(b.millisUTC) - Number(a.millisUTC));
  const latest = rows[0];
  const price = parseFloat(latest.price);
  if (Number.isNaN(price)) {
    throw new Error(`Unparseable price: ${latest.price}`);
  }
  return { price, at: new Date(Number(latest.millisUTC)) };
}

async function fireIfttt(event, payload) {
  const url = `https://maker.ifttt.com/trigger/${event}/json/with/key/${IFTTT_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`IFTTT ${event} returned HTTP ${res.status}: ${body}`);
  }
  console.log(`Fired ${event} -> HTTP ${res.status}`);
}

// ---- Main ---------------------------------------------------------------

(async () => {
  const now = new Date();
  const { isDay, threshold } = thresholdFor(now);
  const { price, at } = await fetchCurrentPrice();

  const newState = price >= threshold ? "high" : "low";
  const prev = readState();

  console.log(
    `price=${price.toFixed(1)}c reading=${at.toISOString()} ` +
      `period=${isDay ? "day" : "night"} threshold=${threshold}c ` +
      `state=${newState} previous=${prev.state ?? "none"}`
  );

  if (prev.state === newState) {
    console.log("No state change — not firing IFTTT.");
    return;
  }

  await fireIfttt(`comed_price_${newState}`, {
    value1: price.toFixed(1),
    value2: isDay ? "day" : "night",
    value3: threshold.toFixed(1),
  });

  writeState({
    state: newState,
    price,
    period: isDay ? "day" : "night",
    threshold,
    changedAt: now.toISOString(),
  });
  console.log(`State changed to "${newState}" and recorded.`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
