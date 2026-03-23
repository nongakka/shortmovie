const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const fs = require("fs").promises;

const BASE = "https://www.xn--72c9ab1ec1bc6q.online";

const PROXY = "https://hidden-unit-7e8b.hssmnoy.workers.dev/?url=";

// 🔥 แปลงเป็น 720p
function to720(url) {
  if (!url) return null;

  // 🔥 บังคับ playlist → 720p
  if (url.includes("playlist.m3u8")) {
    return url.replace("playlist.m3u8", "720p/video.m3u8");
  }

  if (url.includes("/720p/")) return url;

  return url.replace(/\/480p\//, "/720p/");
}

// 🔥 ใส่ proxy
function toProxy(url) {
  if (!url) return null;

  // 🔥 ใช้แบบนี้ก่อน (แก้ 400 / key ไม่โหลด)
  return PROXY + url;

  // ❗ ถ้า worker บางตัวต้อง encode ค่อยสลับ
  // return PROXY + encodeURIComponent(url);
}

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
      "--disable-dev-shm-usage", // 👈 สำคัญบน action
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
  let rawTitle = $("title").text().trim();

let title = rawTitle
  .split(/[-|]/)[0]
  .replace(/ดูหนัง.*$/g, "")
  .replace(/หนัง.*$/g, "")
  .trim();

if (!title || title.length < 2) {
  title = rawTitle;
}
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
async function getM3U8FromDirect(page, url) {

  console.log("🎬 OPEN:", url);

  let found = null;

  // 🔥 ดักทุก request
  page.on("response", async (res) => {
    try {
      const resUrl = res.url();

      if (resUrl.includes(".m3u8")) {
        console.log("🎯 FOUND M3U8:", resUrl);

        if (!found) {
          found = resUrl;
        }
      }

    } catch {}
  });

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  // 🔥 ลอง trigger player
  try { await page.click("video"); } catch {}
  try { await page.click(".jwplayer"); } catch {}

  // 🔥 รอโหลด stream
  await sleep(5000);

  if (!found) {
    console.log("❌ NO M3U8 FROM:", url);
  }

  return found;
}
// --------------------
// save m3u
// --------------------
async function saveM3U(category, movies) {
  const safe = category.replace(/[\\/:*?"<>|]/g, "");

  let content = "#EXTM3U\n";

  for (const m of movies) {
    content += `#EXTINF:-1 tvg-logo="${m.logo}" group-title="${category}",${m.title}\n`;
    content += `${m.servers[0].url}\n\n`;
  }

  await fs.mkdir("m3u", { recursive: true });
  await fs.writeFile(`m3u/${safe}.m3u`, content);
}

async function saveAllM3U(movies) {
  let content = "#EXTM3U\n";

  for (const m of movies) {
    content += `#EXTINF:-1 tvg-logo="${m.logo}" group-title="${m.group}",${m.title}\n`;
    content += `${m.servers[0].url}\n\n`;
  }

  await fs.writeFile(`m3u/all.m3u`, content);
}

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
  const page = await browser.newPage();
  const allResults = [];
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
        const pageDetail = await browser.newPage();
const detail = await getDirect(pageDetail, m.link);
await pageDetail.close();

        if (!detail.direct) continue;

        const pageVideo = await browser.newPage();
const m3u8 = await getM3U8FromDirect(pageVideo, detail.direct);
await pageVideo.close();

        if (!m3u8) {
          console.log("❌ no m3u8");
          continue;
        }

        // 🔥 แปลงเป็น 720p
const m3u8_720 = to720(m3u8);

// 🔥 proxy
const proxyM3U8 = toProxy(m3u8_720) || m3u8_720;

const movieData = {
  title: detail.title,
  poster: detail.poster,

  servers: [
    {
      name: "HLS 720p",
      type: "hls",
      url: proxyM3U8
    },
    {
      name: "Direct",
      type: "iframe",
      url: detail.direct
    }
  ],

  group: cat.name
};

results.push(movieData);
allResults.push(movieData); // 🔥 เก็บรวม

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

  // 🔥 กันลิงก์ซ้ำ
const seen = new Set();
const unique = [];

for (const m of allResults) {
  if (!seen.has(m.servers[0].url)) {
  seen.add(m.servers[0].url);
    unique.push(m);
  }
}
// 🔥 save json รวม
await saveAllJSON(unique);
console.log("📦 saved: all.json");
// 🔥 save รวมทุกหมวด
await saveAllM3U(unique);
console.log("📺 saved: all.m3u");

await browser.close();
console.log("\n🎉 DONE");
}

run();
