// Weekly free-tier data refresh: pulls the latest headline per company from
// Google News RSS (no API key required) and writes data/live-updates.json.
// Run by .github/workflows/weekly-update.yml on a cron schedule.
import { readFile, writeFile } from "node:fs/promises";

const COMPANIES_PATH = new URL("../data/companies.json", import.meta.url);
const OUTPUT_PATH = new URL("../data/live-updates.json", import.meta.url);

const FUNDING_KEYWORDS = /(raises|funding|series [a-e]|valuation|ipo|invest|acqui|billion|million)/i;
const MONEY_RE = /(US\$|\$|¥|€)\s?[\d,.]+\s?(billion|million|bn|m|b)?/i;
const REQUEST_DELAY_MS = 500;

function stripXml(str = "") {
  return str.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").replace(/<[^>]+>/g, "").trim();
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return m ? stripXml(m[1]) : "";
}

async function fetchNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`RSS fetch failed (${res.status})`);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return items.slice(0, 5).map((item) => ({
    title: extractTag(item, "title"),
    link: extractTag(item, "link"),
    pubDate: extractTag(item, "pubDate"),
  }));
}

function pickSignal(items) {
  const fundingHit = items.find((it) => FUNDING_KEYWORDS.test(it.title));
  const chosen = fundingHit || items[0];
  if (!chosen) return null;
  const money = chosen.title.match(MONEY_RE);
  return {
    headline: chosen.title,
    link: chosen.link,
    date: chosen.pubDate,
    detectedFigure: money ? money[0] : null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const companies = JSON.parse(await readFile(COMPANIES_PATH, "utf8"));
  const result = { generatedAt: new Date().toISOString(), companies: {} };

  for (const company of companies) {
    try {
      const items = await fetchNews(company.query);
      const signal = pickSignal(items);
      if (signal) result.companies[company.name] = signal;
    } catch (err) {
      console.error(`Skipping ${company.name}: ${err.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  await writeFile(OUTPUT_PATH, JSON.stringify(result, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(result.companies).length}/${companies.length} signals to data/live-updates.json`);
}

main();
