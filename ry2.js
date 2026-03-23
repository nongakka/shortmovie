const fs = require("fs");
const axios = require("axios");

// ฟังก์ชันดึง seriesData จากหน้าเว็บ
async function fetchSeriesData() {
  const url = "https://rongyok.com/category?category=new";
  const res = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.188 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://rongyok.com/",
    }
  });
  const match = res.data.match(/const seriesData = (\[.*\]);/s);
  if (!match) throw new Error("ไม่พบ seriesData ในหน้าเว็บ");
  return JSON.parse(match[1]);
}

// ฟังก์ชัน filter ตามหมวด
function filterByCategory(series, category) {
  switch(category) {
    case "new":
      return [...series].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    case "popular":
      return [...series].sort((a,b) => b.view_count - a.view_count);
    case "thai":
      return series.filter(m => m.title.toLowerCase().endsWith("th"));
    case "sub":
      return series.filter(m => m.title.toLowerCase().endsWith("sub"));
    default:
      return series;
  }
}

// ฟังก์ชันสร้าง playlist
function buildPlaylist(item) {
  const tag = item.title.toLowerCase().endsWith("th") ? "พากย์ไทย" : 
              item.title.toLowerCase().endsWith("sub") ? "ซับไทย" : "";
  const displayTitle = item.title.replace(/(th|sub)$/i,"").trim();
  
  return {
    title: displayTitle,
    tag,
    image: "https://rongyok.com/" + item.poster_url.replace(/^\/+/,""),
    episodes: [
      {
        name: "EP1",
        servers: [{ name: tag==="พากย์ไทย"?"TH":"EN", url: item.video_url || "" }]
      }
    ]
  };
}

(async () => {
  try {
    console.log("⏳ กำลังโหลด seriesData จากเว็บ...");
    const seriesData = await fetchSeriesData();
    console.log(`✅ โหลด seriesData แล้ว (${seriesData.length} เรื่อง)`);

    const categories = ["new","popular","thai","sub"];
    let allPlaylists = [];
    let allIds = new Set();

    for(const cat of categories) {
      const filtered = filterByCategory(seriesData, cat);
      const playlists = filtered.map(buildPlaylist);

      // บันทึกไฟล์แยกหมวด
      fs.writeFileSync(`category-${cat}.json`, JSON.stringify(playlists, null, 2));

      // รวมโดยตัดซ้ำ
      for(const p of playlists) {
        const key = p.title + "|" + p.tag;
        if(!allIds.has(key)) {
          allPlaylists.push(p);
          allIds.add(key);
        }
      }

      console.log(`✅ หมวด ${cat} บันทึกแล้ว (${playlists.length} เรื่อง)`);
    }

    // บันทึกไฟล์รวม
    fs.writeFileSync("all.json", JSON.stringify(allPlaylists, null, 2));
    console.log(`✅ บันทึก all.json แล้ว (${allPlaylists.length} เรื่องไม่ซ้ำ)`);

  } catch(err) {
    console.error("❌ ERROR:", err.message);
  }
})();
