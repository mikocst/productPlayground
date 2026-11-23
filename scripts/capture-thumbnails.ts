import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";
const root = path.join(process.cwd(), "app", "prototypes");
const out = path.join(process.cwd(), "public", "thumbnails");
fs.mkdirSync(out, { recursive: true });

const requested = args.filter((arg) => !arg.startsWith("--"));
const missingOnly = args.includes("--missing");
const slugs = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((slug) => requested.length === 0 || requested.includes(slug))
  .filter((slug) => !missingOnly || !fs.existsSync(path.join(out, `${slug}-light.png`)) || !fs.existsSync(path.join(out, `${slug}-dark.png`)));

async function capture() {
  const browser = await chromium.launch({ headless: true });
  for (const slug of slugs) {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/prototypes/${slug}`, { waitUntil: "networkidle" });
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({ path: path.join(out, `${slug}-light.png`) });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload({ waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(out, `${slug}-dark.png`) });
    await page.close();
  }
  await browser.close();
}

capture().catch((error) => { console.error(error); process.exit(1); });
