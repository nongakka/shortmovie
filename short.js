const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const fs = require("fs").promises;

const BASE = "https://www.xn--72c9ab1ec1bc6q.online";

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// --------------------
// เปิด browser
// --------------------
async function initBrowser() {
  return await puppeteer.launch({
    headless: "new", // 👈 สำคัญ
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled"
    ]
  });
}

// --------------------
// 1. หมวด
// --------------------
async function getCategories(page) {
  await page.goto(`${BASE}/categories.php`, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  const html = await page.content();
  const $ = cheerio.load(html);

  const map = new Map(); // 👈 ใช้กันซ้ำ

  $("a").each((i, el) => {
    const href = $(el).attr("href");
    const name = $(el).text().trim();

    if (href && href.includes("categories.php?id=")) {
      const cleanName = name.replace(/\s+/g, " ");
      const link = BASE + "/" + href;

      map.set(link, { name: cleanName, link });
    }
  });

  return [...map.values()];
}

// --------------------
// 2. หนัง
// --------------------
async function getMovies(page, url) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  const html = await page.content();
  const $ = cheerio.load(html);

  const set = new Set();

  $("a").each((i, el) => {
    const href = $(el).attr("href");

    if (href && href.includes("movie-article.php?id=")) {
      set.add(BASE + "/" + href);
    }
  });

  return [...set].map(link => ({ link }));
}

// --------------------
// 3. movie → direct
// --------------------
async function getDirect(page, url) {
  await page.goto(url, {
  waitUntil: "domcontentloaded",
  timeout: 60000
});

  const html = await page.content();
  const $ = cheerio.load(html);

  let direct = null;
  let title = $("title").text().trim();
  let poster =
  $("img").first().attr("src") ||
  $("img").first().attr("data-src") ||
  $("img").first().attr("data-lazy") ||
  "";

// 👉 กันเป็น relative path
if (poster && !poster.startsWith("http")) {
  poster = BASE + "/" + poster.replace(/^\/+/, "");
}

  $("a").each((i, el) => {
    const href = $(el).attr("href");
    if (href && href.includes("direct-video.php")) {
      direct = BASE + "/" + href;
    }
  });

  return { direct, title, poster };
}

// --------------------
// 4. direct → m3u8
// --------------------
async function getM3U8(page, url) {
  let found = null;

  const listener = (res) => {
    const u = res.url();
    if (u.includes(".m3u8")) {
      found = u;
    }
  };

  page.on("response", listener);

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await sleep(3000);

  page.off("response", listener);

  if (found) return found;

  // 👉 fallback cheerio เหมือนเดิม
  const html = await page.content();
  const $ = cheerio.load(html);

  let m3u8 = null;

  $("script").each((i, el) => {
    const txt = $(el).html();
    if (!txt) return;

    const patterns = [
      /videoSrc\s*=\s*['"](.*?)['"]/,
      /file\s*:\s*['"](.*?)['"]/,
      /source\s*:\s*['"](.*?)['"]/,
      /(https?:\/\/.*?\.m3u8.*?)['"]/
    ];

    for (const reg of patterns) {
      const match = txt.match(reg);
      if (match) {
        m3u8 = match[1];
        break;
      }
    }
  });

  return m3u8;
}

// --------------------
// save m3u
// --------------------
async function saveM3U(category, movies) {
  const safe = category.replace(/[\\/:*?"<>|]/g, "");

  let content = "#EXTM3U\n";

  for (const m of movies) {
    content += `#EXTINF:-1 tvg-logo="${m.logo}" group-title="${category}",${m.title}\n`;
    content += `${m.m3u8}\n\n`;
  }

  await fs.mkdir("m3u", { recursive: true });
  await fs.writeFile(`m3u/${safe}.m3u`, content);
}

// --------------------
// MAIN
// --------------------
async function run() {
  const browser = await initBrowser();
  const page = await browser.newPage();

// 👇 เพิ่มตรงนี้
await page.setUserAgent(
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
);

await page.setViewport({ width: 1366, height: 768 });

page.setDefaultNavigationTimeout(60000);
page.setDefaultTimeout(60000);

  await fs.mkdir("json", { recursive: true });

  console.log("🌐 bypass cloudflare...");

  const categories = await getCategories(page);
  console.log("📁 categories:", categories.length);

  for (const cat of categories) {
    console.log("\n📁", cat.name);

    const movies = await getMovies(page, cat.link);
console.log("🎬 movies:", movies.length);

if (movies.length === 0) {
  console.log("⏭️ skip (no movies)");
  continue;
}

    const results = [];

    let i = 0;

    for (const m of movies) {
      i++;
      console.log(`➡️ ${i}/${movies.length}`);

      try {
        const detail = await getDirect(page, m.link);

        if (!detail.direct) continue;

        const m3u8 = await getM3U8(page, detail.direct);

        if (!m3u8) {
          console.log("❌ no m3u8");
          continue;
        }

        results.push({
          title: detail.title,
          logo: detail.poster,
          m3u8
        });

        console.log("✅ OK");

        await sleep(1500);

      } catch (e) {
        console.log("❌ error:", e.message);
      }
    }

    const safe = cat.name.replace(/[\\/:*?"<>|]/g, "");
    await fs.writeFile(`json/${safe}.json`, JSON.stringify(results, null, 2));

    await saveM3U(cat.name, results);

    console.log("💾 saved:", cat.name);
  }

  await browser.close();
  console.log("\n🎉 DONE");
}

run();