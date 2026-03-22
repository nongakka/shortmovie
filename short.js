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
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
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

  const map = new Map();

  $("a").each((i, el) => {
    const href = $(el).attr("href");
    const name = $(el).text().trim();

    if (href && href.includes("categories.php?id=")) {
      const cleanName = name.replace(/\s+/g, " ");
      const link = href.startsWith("http")
        ? href
        : BASE + "/" + href.replace(/^\/+/, "");

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
      const link = href.startsWith("http")
        ? href
        : BASE + "/" + href.replace(/^\/+/, "");

      set.add(link);
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

  if (poster && !poster.startsWith("http")) {
    poster = BASE + "/" + poster.replace(/^\/+/, "");
  }

  $("a").each((i, el) => {
    const href = $(el).attr("href");

    if (href && href.includes("direct-video.php")) {
      direct = href.startsWith("http")
        ? href
        : BASE + "/" + href.replace(/^\/+/, "");
    }
  });

  return { direct, title, poster };
}

// --------------------
// save
// --------------------
async function saveAllJSON(movies) {
  await fs.writeFile(
    `json/all.json`,
    JSON.stringify(movies, null, 2)
  );
}

// --------------------
// MAIN
// --------------------
async function run() {
  const browser = await initBrowser();
  const mainPage = await browser.newPage();

  await mainPage.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  await mainPage.setViewport({ width: 1366, height: 768 });

  const allResults = [];

  await fs.mkdir("json", { recursive: true });

  console.log("🌐 start...");

  const categories = await getCategories(mainPage);
  console.log("📁 categories:", categories.length);

  for (const cat of categories) {
    console.log("\n📁", cat.name);

    const movies = await getMovies(mainPage, cat.link);
    console.log("🎬 movies:", movies.length);

    if (movies.length === 0) continue;

    const results = [];
    let i = 0;

    for (const m of movies) {
      i++;
      console.log(`➡️ ${i}/${movies.length}`);

      let p;

      try {
        p = await browser.newPage();

        await p.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        let detail = null;

        // 🔥 retry 3 ครั้ง
        for (let retry = 0; retry < 3; retry++) {
          try {
            detail = await getDirect(p, m.link);
            if (detail.direct) break;
          } catch {}

          console.log("🔁 retry...");
          await sleep(1000);
        }

        if (!detail || !detail.direct) {
          console.log("❌ no direct");
          continue;
        }

        console.log("🎯 DIRECT:", detail.direct);

        const movieData = {
          title: detail.title,
          logo: detail.poster,
          embed: detail.direct,
          group: cat.name
        };

        results.push(movieData);
        allResults.push(movieData);

        console.log("✅ OK");

        await sleep(1500);

      } catch (e) {
        console.log("❌ error:", e.message);
      } finally {
        if (p) await p.close();
      }
    }

    const safe = cat.name.replace(/[\\/:*?"<>|]/g, "");
    await fs.writeFile(
      `json/${safe}.json`,
      JSON.stringify(results, null, 2)
    );

    console.log("💾 saved:", cat.name);
  }

  // 🔥 remove duplicate
  const seen = new Set();
  const unique = [];

  for (const m of allResults) {
    if (!seen.has(m.embed)) {
      seen.add(m.embed);
      unique.push(m);
    }
  }

  await saveAllJSON(unique);
  console.log("📦 saved: all.json");

  await browser.close();
  console.log("\n🎉 DONE");
}

run();
