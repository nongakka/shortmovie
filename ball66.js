const axios = require("axios");
const fs = require("fs");

const BASE_PROXY = "https://love.sikoyo3159.workers.dev";

const urls = [
  "https://embed.bananacake.org/dooball66v2/ajax_channels.php?api_key=hmcb4rf66f&sportsonly=1",
  "https://embed.bananacake.org/dooball66v2/ajax_channels.php?api_key=hmcb4rf66f"
];

// regex ดึง channel
const regex = /src\s*=\s*'([^']+)'.*?loadPlayer\('([^']+)'\)/gs;

async function main() {
  const map = {};

  for (const url of urls) {
    const res = await axios.get(url);

    let match;
    while ((match = regex.exec(res.data)) !== null) {
      const logo = match[1];
      const id = match[2];

      if (!map[id]) {
        // 🔥 generate stream ตรง ๆ
        const stream = `${BASE_PROXY}/lx-origin/${id}_720/chunks.m3u8`;

        map[id] = {
          name: id,
          logo: logo,
          stream_url: stream
        };
      }
    }
  }

  const channels = Object.values(map);

  // save JSON
  fs.writeFileSync("playlist.json", JSON.stringify(channels, null, 2));

  // 🔥 M3U
  let m3u = "#EXTM3U\n";

  channels.forEach(ch => {
    m3u += `#EXTINF:-1 tvg-logo="${ch.logo}",${ch.name}\n`;
    m3u += `${ch.stream_url}\n`;
  });

  fs.writeFileSync("playlist.m3u", m3u);

  console.log("✅ DONE:", channels.length);
}

main();