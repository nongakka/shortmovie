const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

const BASE = "https://rongyok.com";
const PROXY = "https://raspy-sea-8787.hssmnoy.workers.dev";

// ===== helper proxy =====
function proxy(url) {
  return `${PROXY}?url=${encodeURIComponent(url)}`;
}

// ===== axios config กัน 403 =====
const http = axios.create({
  timeout: 30000,
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Accept": "text/html,application/xhtml+xml",
  }
});

// ===== ดึง seriesData =====
async function scrapeCategoryData(url) {
  const res = await http.get(proxy(url));
  const html = res.data;

  const match = html.match(/const seriesData = (\[.*?\]);/s);
  if (!match) return [];

  const data = JSON.parse(match[1]);

  return data.map(item => ({
    id: item.id,
    title: item.title,
    created_at: item.created_at,
    view_count: item.view_count || 0,
    poster_url: item.poster_url.startsWith("http")
      ? item.poster_url
      : `${BASE}/${item.poster_url.replace(/^\/+/, "")}`,
  }));
}

// ===== ดึง episodes =====
async function scrapeDetailAndEpisodes(id) {
  const url = `${BASE}/series/${id}`;
  const res = await http.get(proxy(url));
  const $ = cheerio.load(res.data);

  const h1 = $("h1.text-red-500");
  let title = h1.clone().children().remove().end().text().trim();
  title = title.replace(/^รายละเอียดซีรี่ส์\s*/, "");
  const tag = h1.find("span").text().trim();

  let image = $('img').first().attr("src");
  if (image && !image.startsWith("http")) {
    image = `${BASE}/${image.replace(/^\/+/, "")}`;
  }

  const watch_path = $('a[href*="/watch/"]').attr("href");
  if (!watch_path) return null;
  const watch_url = BASE + watch_path;

  const watchRes = await http.get(proxy(watch_url));
  const watchHtml = watchRes.data;

  const match = watchHtml.match(/const seriesData = (\{.*?\});/s);
  if (!match) return null;

  const seriesData = JSON.parse(match[1]);
  if (!seriesData?.episodes) return null;

  const episodes = [];
  const lang = tag.includes("พากย์ไทย") ? "TH" : "EN";

  // ===== 🔍 เช็คว่ามี EP1 ไหม =====
  const hasEp1 = seriesData.episodes.some(
    ep => ep.episode_number === 1
  );

  // ===== ✅ สร้าง EP1 ถ้าไม่มี =====
  if (!hasEp1) {
    episodes.push({
      name: "EP1",
      servers: [
        {
          name: `${lang}-iframe`,
          url: `${BASE}/watch/?series_id=${id}`
        }
      ]
    });
  }

  // ===== ✅ EP2+ (หรือ EP1 ถ้ามีอยู่แล้ว) =====
  seriesData.episodes.forEach(ep => {

    const epNum = ep.episode_number;
    const iframeUrl = epNum === 1
      ? `${BASE}/watch/?series_id=${id}`
      : `${BASE}/watch/?series_id=${id}&ep=${epNum}`;

    const servers = [];

    // iframe (ไม่ตาย)
    servers.push({
      name: `${lang}-iframe`,
      url: iframeUrl
    });

    // video จริง (อาจตาย)
    if (ep.video_url) {
      servers.push({
        name: `${lang}-m3u8`,
        url: ep.video_url
      });
    }

    episodes.push({
      name: `EP${epNum}`,
      servers
    });

  });

  // ===== 🔥 เรียงตอนให้ถูก =====
  episodes.sort((a, b) => {
    const aNum = parseInt(a.name.replace("EP", ""));
    const bNum = parseInt(b.name.replace("EP", ""));
    return aNum - bNum;
  });

  return {
    title,
    tag,
    image,
    episodes,
    created_at: seriesData.created_at || new Date().toISOString(),
    view_count: seriesData.view_count || 0
  };
}

// ===== MAIN =====
(async () => {
  const catUrl = "https://rongyok.com/category?category=new";
  console.log("📂 หมวด:", catUrl);

  const seriesList = await scrapeCategoryData(catUrl);

  const detailList = [];

  for (const item of seriesList) {
    try {
      console.log("  ▶", item.title);
      const detail = await scrapeDetailAndEpisodes(item.id);
      if (detail) detailList.push(detail);
    } catch (err) {
      console.log("  ❌ ข้าม:", item.title);
    }
  }

  // ===== แยกหมวดแบบเว็บ =====
  const playlistsByCategory = {
    new: [],
    popular: [],
    thai: [],
    sub: []
  };

  const allPlaylists = [];
  const allIds = new Set();

  for (const item of detailList) {
    const key = item.title + "|" + item.tag;

    // all (กันซ้ำ)
    if (!allIds.has(key)) {
      allPlaylists.push(item);
      allIds.add(key);
    }

    // new / popular
    playlistsByCategory.new.push(item);
    playlistsByCategory.popular.push(item);

    // thai / sub
    if (item.tag.includes("พากย์ไทย")) {
      playlistsByCategory.thai.push(item);
    } else if (item.tag.includes("ซับไทย")) {
      playlistsByCategory.sub.push(item);
    }
  }

  // ===== apply logic ตามเว็บ =====
  playlistsByCategory.new = playlistsByCategory.new
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 100);

  playlistsByCategory.popular = playlistsByCategory.popular
    .sort((a, b) => b.view_count - a.view_count)
    .slice(0, 100);

  // ===== save =====
  for (const [name, list] of Object.entries(playlistsByCategory)) {
    fs.writeFileSync(`category-${name}.json`, JSON.stringify(list, null, 2));
    console.log(`✅ ${name} (${list.length} เรื่อง)`);
  }

  fs.writeFileSync("all.json", JSON.stringify(allPlaylists, null, 2));
  console.log(`✅ all (${allPlaylists.length} เรื่องไม่ซ้ำ)`);

})();
