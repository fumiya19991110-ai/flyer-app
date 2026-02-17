/**
 * API キー動作確認用の最小テストスクリプト
 * - 1店舗（スーパーみらべる東十条店）のみ
 * - チラシ画像1枚のみ
 * - gemini-1.5-flash 使用
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { chromium } from "playwright";
import * as https from "https";
import * as http from "http";

// .env.local を手動で読み込み
import * as fs from "fs";
import * as path from "path";
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.+)\s*$/);
    if (match) process.env[match[1]] = match[2];
  }
}

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("GEMINI_API_KEY が .env.local に見つかりません");
  process.exit(1);
}

function downloadImage(url: string): Promise<{ base64: string; mimeType: string; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    const doReq = (target: string, depth = 0) => {
      if (depth > 5) { reject(new Error("Too many redirects")); return; }
      const client = target.startsWith("https") ? https : http;
      client.get(target, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doReq(res.headers.location, depth + 1); return;
        }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({
            base64: buf.toString("base64"),
            mimeType: (res.headers["content-type"] || "image/jpeg").split(";")[0].trim(),
            sizeBytes: buf.length,
          });
        });
        res.on("error", reject);
      }).on("error", reject);
    };
    doReq(url);
  });
}

async function main() {
  console.log("=== API キー動作テスト ===\n");

  // Step 1: 1店舗だけスクレイピング
  const storeUrl = "https://chirashi.kurashiru.com/stores/3836e998-39a3-462d-a0d0-40eba62a0046";
  console.log("1. スクレイピング中: スーパーみらべる東十条店");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  });
  await page.goto(storeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  // チラシ詳細ページへ遷移
  const flyerLinks = page.locator('a[href*="/flyers/"]');
  const linkCount = await flyerLinks.count();
  let imageUrl: string | null = null;

  if (linkCount > 0) {
    const href = await flyerLinks.first().getAttribute("href");
    if (href) {
      const flyerUrl = href.startsWith("http") ? href : `https://chirashi.kurashiru.com${href}`;
      await page.goto(flyerUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000);
    }
  }

  // 500px以上の画像を1枚だけ取得
  const imgs = page.locator("img");
  const imgCount = await imgs.count();
  for (let i = 0; i < imgCount; i++) {
    const img = imgs.nth(i);
    const src = await img.getAttribute("src");
    if (!src || src.includes("logo") || src.includes("icon") || src.includes("avatar")) continue;
    const dims = await img.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight }));
    if (dims.w >= 500 || dims.h >= 500) {
      imageUrl = src.startsWith("http") ? src : `https://chirashi.kurashiru.com${src}`;
      break;
    }
  }
  await browser.close();

  if (!imageUrl) {
    // フォールバック: 小さめの画像でも1枚試す
    console.log("  500px以上の画像なし。全画像から最初の1枚を使用");
    const browser2 = await chromium.launch({ headless: true });
    const page2 = await browser2.newPage();
    await page2.goto(storeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page2.waitForTimeout(3000);
    const allImgs = page2.locator("img");
    for (let i = 0; i < await allImgs.count(); i++) {
      const src = await allImgs.nth(i).getAttribute("src");
      if (src && !src.includes("logo") && !src.includes("icon") && !src.includes("svg")) {
        imageUrl = src.startsWith("http") ? src : `https://chirashi.kurashiru.com${src}`;
        break;
      }
    }
    await browser2.close();
  }

  if (!imageUrl) {
    console.error("画像が見つかりませんでした。サイト構造が変わった可能性があります。");
    process.exit(1);
  }

  console.log(`  画像URL: ${imageUrl.substring(0, 100)}...`);

  // Step 2: 画像ダウンロード
  console.log("\n2. 画像ダウンロード中...");
  const { base64, mimeType, sizeBytes } = await downloadImage(imageUrl);
  console.log(`  完了: ${mimeType}, ${Math.round(sizeBytes / 1024)}KB`);

  if (sizeBytes < 50 * 1024) {
    console.warn(`  警告: 画像が小さい (${Math.round(sizeBytes / 1024)}KB)。チラシ本体でない可能性あり`);
  }

  // Step 3: Gemini API テスト
  console.log("\n3. Gemini API 呼び出し中 (gemini-2.0-flash, v1beta)...");
  const genAI = new GoogleGenerativeAI(API_KEY!);
  const model = genAI.getGenerativeModel(
    { model: "gemini-2.0-flash" },
    { apiVersion: "v1beta" }
  );

  const prompt = `この画像はスーパーのチラシです。最初の3商品だけ抽出してJSON形式で返してください:
{"products":[{"productName":"商品名","price":{"taxIncl":100},"category":"肉"}]}
JSONのみ出力してください。`;

  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType, data: base64 } },
  ]);

  const text = result.response.text();
  console.log("\n4. API レスポンス:");
  console.log("---");
  console.log(text);
  console.log("---");

  // JSON パースチェック
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`\n✅ 成功！ ${parsed.products?.length ?? 0}商品を取得`);
      if (parsed.products?.[0]) {
        console.log(`  例: ${parsed.products[0].productName} - ¥${parsed.products[0].price?.taxIncl ?? "?"}`);
      }
    } catch {
      console.error("\n❌ JSONパースエラー");
    }
  } else {
    console.error("\n❌ レスポンスにJSONが含まれていません");
  }
}

main().catch((err) => {
  console.error("\n❌ エラー:", err instanceof Error ? err.message : err);
  process.exit(1);
});
