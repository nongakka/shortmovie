const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const fs = require("fs").promises;

const BASE = "https://www.xn--72c9ab1ec1bc6q.online";

const PROXY = "https://hidden-unit-7e8b.hssmnoy.workers.dev/?url=";

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

  // ✅ ดัก request (แทน response)
  page.on("request", (req) => {
    const reqUrl = req.url();

    if (reqUrl.includes(".m3u8")) {
      console.log("🎯 M3U8:", reqUrl);

      if (!found) {
        found = reqUrl;
      }
    }
  });

  // ✅ รอ network เงียบ (สำคัญมาก)
  await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 60000
  });

  // ✅ บังคับให้ video เล่น
  await page.evaluate(() => {
    const v = document.querySelector("video");
    if (v) {
      v.muted = true;
      v.play().catch(() => {});
    }
  });

  // ✅ รอให้มันโหลด stream
  await new Promise(r => setTimeout(r, 8000));

  if (!found) {
    console.log("❌ NO M3U8 FROM:", url);
  }

  // ✅ กัน memory leak
  page.removeAllListeners("request");

  return found;
}
// --------------------
// save m3u
// --------------------
async function saveM3U(category, movies) {
  const cleanCategory = category.replace(/\s+\d+$/, "");

const safe = cleanCategory
  .replace(/[\\/:*?"<>|]/g, "");

let content = "#EXTM3U\n";

for (const m of movies) {
  content += `#EXTINF:-1 tvg-logo="${m.logo}" group-title="${cleanCategory}",${m.title}\n`;
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
  let oldData = [];

try {
  const raw = await fs.readFile("json/all.json", "utf-8");
  oldData = JSON.parse(raw);
  console.log("📦 old:", oldData.length);
} catch {
  console.log("ℹ️ no old data");
}

// ✅ 🔥 เอาของเก่ามาเป็น base
const allResults = [...oldData];

const oldSet = new Set(oldData.map(m => m.link).filter(Boolean));
  
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
      if (oldSet.has(m.link)) {
  console.log("⏭️ skip old:", m.link);
  continue;
}      
      
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
      
const proxyM3U8 = toProxy(m3u8) || m3u8;

const movieData = {
  title: detail.title,
  poster: detail.poster,
  link: m.link,
  
  servers: [
    {
      name: "M3U8",
      type: "hls",
      url: proxyM3U8
    },
    ],

  group: cat.name.replace(/\s+\d+$/, "")
};

results.push(movieData);
allResults.push(movieData); // 🔥 เก็บรวม
oldSet.add(m.link);
        
        console.log("✅ OK");

        await sleep(1500);

      } catch (e) {
        console.log("❌ error:", e.message);
      }
    }

    const safe = cat.name
  .replace(/\s+\d+$/, "")   // 🔥 ตัดเลขท้าย
  .replace(/[\\/:*?"<>|]/g, "");
    
    await fs.writeFile(`json/${safe}.json`, JSON.stringify(results, null, 2));

    const cleanName = cat.name.replace(/\s+\d+$/, "");

await saveM3U(cleanName, results);

    console.log("💾 saved:", cat.name);
  }

  // 🔥 กันลิงก์ซ้ำ
const seen = new Set();
const unique = [];

for (const m of allResults) {
  if (!seen.has(m.link)) {
    seen.add(m.link);
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
