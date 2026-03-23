const fs = require("fs");

// โหลด seriesData จากหน้าเว็บ (copy จาก <script>const seriesData = [...]</script>)
const seriesData = require("./seriesData.json"); // สมมติคุณบันทึก seriesData ดิบไว้

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

// หมวดที่ต้องการ
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
