import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import { GoogleGenerativeAI } from "@google/generative-ai";

const envPath = path.join(__dirname, "..", ".env.local");
for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
  const m = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

function dl(url: string): Promise<Buffer> {
  return new Promise((res, rej) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (r) => {
      const c: Buffer[] = [];
      r.on("data", (d: Buffer) => c.push(d));
      r.on("end", () => res(Buffer.concat(c)));
      r.on("error", rej);
    }).on("error", rej);
  });
}

async function main() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel(
    { model: "gemini-2.0-flash" },
    { apiVersion: "v1beta" }
  );

  const urls = [
    "https://video.kurashiru.com/production/chirashiru_leaflet/image/2801263/compressed_Miraberu_260217_hyoushi.jpg",
    "https://video.kurashiru.com/production/chirashiru_leaflet/image/2801264/compressed_Miraberu_260217_ura.jpg",
    "https://video.kurashiru.com/production/chirashiru_leaflet/image/2801265/compressed_Miraberu_260217_a.jpg",
  ];

  for (let i = 0; i < urls.length; i++) {
    console.log(`\n[${i + 1}/${urls.length}] ダウンロード中...`);
    const buf = await dl(urls[i]);
    console.log(`  ${Math.round(buf.length / 1024)}KB`);

    try {
      const r = await model.generateContent([
        "商品を1つだけJSON形式で返して",
        { inlineData: { mimeType: "image/jpeg", data: buf.toString("base64") } },
      ]);
      console.log(`  ✅ 成功: ${r.response.text().substring(0, 80)}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ❌ エラー: ${msg.substring(0, 150)}`);
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("\n=== 連続テスト完了 ===");
}

main();
