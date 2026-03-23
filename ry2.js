const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

const BASE = "https://rongyok.com";

// ===== ดึง seriesData จากหน้า category =====
async function scrapeCategoryData(url) {
  const res = await axios.get(url);
  const html = res.data;

  // regex ดึง JSON จาก <script>
  const match = html.match(/const seriesData = (\[.*?\]);/s);
  if (!match) return [];

  const data = JSON.parse(match[1]);

  // map ให้เหมือนโครงสร้างเดิม
  return data.map(item => ({
    id: item.id,
    title: item.title,
    description: item.description,
    poster_url: item.poster_url.startsWith("http") ? item.poster_url : `${BASE}/${item.poster_url.replace(/^\/+/, "")}`,
    jpg_url: item.jpg_url.startsWith("http") ? item.jpg_url : `${BASE}/${item.jpg_url.replace(/^\/+/, "")}`,
  }));
}

// ===== ดึงรายละเอียด + episodes =====
async function scrapeDetailAndEpisodes(id) {
  const url = `${BASE}/series/${id}`;
  const res = await axios.get(url);
  const $ = cheerio.load(res.data);

  // title + tag
  const h1 = $("h1.text-red-500");
  const title = h1.clone().children().remove().end().text().trim();
  const tag = h1.find("span").text().trim();

  // image
  let image = $('img').first().attr("src");
  if (image && !image.startsWith("http")) {
    image = `${BASE}/${image.replace(/^\/+/, "")}`;
  }

  // watch url
  const watch_path = $('a[href*="/watch/"]').attr("href");
  if (!watch_path) return null;
  const watch_url = BASE + watch_path;

  // ดึง seriesData ของ watch
  const watchRes = await axios.get(watch_url);
  const watchHtml = watchRes.data;

  let seriesData = null;
  const scriptMatch = watchHtml.match(/const seriesData = (\{.*?\});/s);
  if (scriptMatch) {
    seriesData = JSON.parse(scriptMatch[1]);
  }

  if (!seriesData || !seriesData.episodes) {
    console.log("❌ หา episodes ไม่เจอ:", title);
    return null;
  }

  // build episodes
  const episodes = seriesData.episodes.map(ep => ({
    name: `EP${ep.episode_number}`,
    servers: [
      {
        name: tag.includes("พากย์ไทย") ? "TH" : "EN",
        url: ep.video_url
      }
    ]
  }));

  return { title, tag, image, episodes };
}

// ===== MAIN =====
(async () => {
  const categories = [
    "https://rongyok.com/category?category=new"
  ];

  let allPlaylists = [];
  let allIds = new Set(); // สำหรับเช็คซ้ำ

  for (const catUrl of categories) {
    console.log("📂 หมวด:", catUrl);

    const seriesList = await scrapeCategoryData(catUrl);
    const categoryResults = [];

    for (const item of seriesList) {
      try {
        console.log("  ▶", item.title);
        const playlist = await scrapeDetailAndEpisodes(item.id);
        if (playlist) {
          categoryResults.push(playlist);

          // เช็คซ้ำสำหรับ all.json
          const key = playlist.title + "|" + playlist.tag;
          if (!allIds.has(key)) {
            allPlaylists.push(playlist);
            allIds.add(key);
          }
        }
      } catch (err) {
        console.log("  ❌ ข้าม:", item.title);
      }
    }

    // ฟังก์ชันแปลงชื่อไฟล์ให้ปลอดภัย
    function safeFilename(url) {
      return url.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    }

    const filename = safeFilename(catUrl.split("category=")[1]);
    fs.writeFileSync(`category-${filename}.json`, JSON.stringify(categoryResults, null, 2));

    console.log(`✅ หมวด ${filename} บันทึกแล้ว (${categoryResults.length} เรื่อง)`);
  }

  fs.writeFileSync("all.json", JSON.stringify(allPlaylists, null, 2));
  console.log(`✅ บันทึก all.json แล้ว (${allPlaylists.length} เรื่องไม่ซ้ำ)`);
})();
