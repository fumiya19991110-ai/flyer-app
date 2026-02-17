import { GoogleGenerativeAI } from "@google/generative-ai";
import { scrapeAllStores, type StoreFlyer } from "./scrape";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import sharp from "sharp";

// .env.local を読み込み（常に .env.local の値を優先）
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const CATEGORIES = [
  "肉",
  "魚",
  "野菜",
  "果物",
  "乳製品",
  "飲料",
  "惣菜",
  "日用品",
  "他",
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface Product {
  productName: string;
  price: {
    taxExcl: number | null;
    taxIncl: number | null;
  };
  unit: string;
  category: Category;
  validFrom: string | null;
  validTo: string | null;
}

export interface StoreProducts {
  storeName: string;
  products: Product[];
  scrapedAt: string;
}

export interface DailyPrices {
  date: string;
  stores: StoreProducts[];
}

const PROMPT = `あなたはスーパーのチラシ画像を解析するAIです。
この画像はスーパーマーケットのチラシです。画像から読み取れるすべての商品情報をJSON形式で抽出してください。

重要: チラシには全体の有効期間（例:「2/17(月)〜2/20(木)」）が記載されていることがありますが、
商品ごとに異なる有効期間が設定されている場合があります（例:「本日限り」「18日のみ」「17日〜18日」など）。
各商品に最も適切な有効期間を判定してください。

今年は${new Date().getFullYear()}年です。日付は必ずYYYY-MM-DD形式で出力してください。

以下のJSON形式で出力してください（JSONのみ、他のテキストは不要）:
{
  "products": [
    {
      "productName": "商品名",
      "price": {
        "taxExcl": 198,
        "taxIncl": 213
      },
      "unit": "100g",
      "category": "肉",
      "validFrom": "2026-02-17",
      "validTo": "2026-02-20"
    }
  ]
}

ルール:
- productName: 商品名をそのまま記載（ブランド名含む）
- price.taxExcl: 税抜き価格（数値）。不明の場合はnull
- price.taxIncl: 税込み価格（数値）。不明の場合はnull。税抜き価格のみの場合は税抜き×1.08で計算
- unit: 単位（例: "1パック", "100g", "1本", "1袋"）。不明の場合は"1点"
- category: 以下のいずれか: "肉", "魚", "野菜", "果物", "乳製品", "飲料", "惣菜", "日用品", "他"
- validFrom: この価格の開始日（YYYY-MM-DD）。「本日限り」なら当日。不明ならチラシ全体の開始日。完全に不明ならnull
- validTo: この価格の終了日（YYYY-MM-DD）。「本日限り」なら当日。不明ならチラシ全体の終了日。完全に不明ならnull
- 読み取れない商品はスキップ
- 価格が完全に読み取れない商品はスキップ
- 必ず有効なJSONのみを出力すること`;

interface DownloadResult {
  base64: string;
  mimeType: string;
  sizeBytes: number;
}

/** 画像URLからBase64データをダウンロード */
function downloadImageAsBase64(url: string): Promise<DownloadResult> {
  return new Promise((resolve, reject) => {
    const doRequest = (targetUrl: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error(`Too many redirects for ${url}`));
        return;
      }
      const client = targetUrl.startsWith("https") ? https : http;
      client
        .get(targetUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            doRequest(res.headers.location, redirectCount + 1);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
            return;
          }

          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const buffer = Buffer.concat(chunks);
            const contentType = res.headers["content-type"] || "image/jpeg";
            const mimeType = contentType.split(";")[0].trim();
            resolve({
              base64: buffer.toString("base64"),
              mimeType,
              sizeBytes: buffer.length,
            });
          });
          res.on("error", reject);
        })
        .on("error", reject);
    };

    doRequest(url);
  });
}

const MIN_IMAGE_SIZE_BYTES = 50 * 1024; // 50KB
const MAX_IMAGES_PER_STORE = 5; // 1店舗あたり最大5枚（クォータ安定後に増やす）
const SLEEP_BETWEEN_IMAGES_MS = 8000; // 解析後の待機時間（8秒）
const RETRY_WAIT_MS = 90000; // 429エラー時のリトライ待機時間（90秒）
const MAX_IMAGE_WIDTH = 1024; // リサイズ上限幅（トークン節約）

/** 画像をリサイズしてトークン消費を削減 */
async function resizeImage(buffer: Buffer): Promise<{ data: Buffer; mimeType: string }> {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 0;

  if (width > MAX_IMAGE_WIDTH) {
    const resized = await sharp(buffer)
      .resize(MAX_IMAGE_WIDTH, undefined, { fit: "inside" })
      .jpeg({ quality: 80 })
      .toBuffer();
    return { data: resized, mimeType: "image/jpeg" };
  }
  return { data: buffer, mimeType: "image/jpeg" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** エラーメッセージから retryDelay の秒数を抽出 */
function parseRetryDelay(msg: string): number {
  const match = msg.match(/retry\s*(?:in|Delay[":]*\s*)"?\s*(\d+)/i);
  return match ? Math.max(parseInt(match[1], 10), RETRY_WAIT_MS / 1000) : RETRY_WAIT_MS / 1000;
}

/** Gemini APIを呼び出す。429なら最大2回リトライ */
async function callGeminiWithRetry(
  model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>,
  prompt: string,
  mimeType: string,
  base64: string
): Promise<string> {
  const parts = [
    prompt,
    { inlineData: { mimeType, data: base64 } },
  ] as const;

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent([...parts]);
      return result.response.text();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const is429 = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("rate");

      if (!is429 || attempt === maxRetries) throw error;

      const waitSec = parseRetryDelay(msg);
      console.warn(`  429 レート制限 → ${waitSec}秒待機してリトライ (${attempt + 1}/${maxRetries})...`);
      await sleep(waitSec * 1000);
    }
  }
  throw new Error("unreachable");
}

async function analyzeFlyer(
  genAI: GoogleGenerativeAI,
  storeName: string,
  imageUrls: string[]
): Promise<Product[]> {
  if (imageUrls.length === 0) {
    console.log(`  ${storeName}: 画像なし、スキップ`);
    return [];
  }

  // 1店舗あたりの解析枚数を制限
  const targetUrls = imageUrls.slice(0, MAX_IMAGES_PER_STORE);
  if (imageUrls.length > MAX_IMAGES_PER_STORE) {
    console.log(`  ${imageUrls.length}枚中 ${MAX_IMAGES_PER_STORE}枚のみ解析（制限中）`);
  }

  const model = genAI.getGenerativeModel(
    { model: "gemini-2.0-flash" },
    { apiVersion: "v1beta" }
  );
  const allProducts: Product[] = [];

  for (let idx = 0; idx < targetUrls.length; idx++) {
    const imageUrl = targetUrls[idx];
    try {
      console.log(`  [${idx + 1}/${targetUrls.length}] 解析中: ${imageUrl.substring(0, 80)}...`);

      // Step 1: 画像をダウンロード
      let downloaded: DownloadResult;
      try {
        downloaded = await downloadImageAsBase64(imageUrl);
      } catch (dlError) {
        console.warn(`  スキップ（ダウンロード失敗）: ${imageUrl}`, dlError instanceof Error ? dlError.message : dlError);
        continue;
      }

      const { sizeBytes } = downloaded;
      const sizeKB = Math.round(sizeBytes / 1024);
      console.log(`  ダウンロード完了 (${sizeKB}KB)`);

      // Step 2: 小さすぎる画像はスキップ（アイコン・サムネイル等）
      if (sizeBytes < MIN_IMAGE_SIZE_BYTES) {
        console.log(`  スキップ（${sizeKB}KB < 50KB: アイコンまたはサムネイル）`);
        continue;
      }

      // Step 2.5: 画像をリサイズしてトークン消費を削減
      const originalBuf = Buffer.from(downloaded.base64, "base64");
      const { data: resizedBuf, mimeType: resizedMime } = await resizeImage(originalBuf);
      const resizedBase64 = resizedBuf.toString("base64");
      const resizedKB = Math.round(resizedBuf.length / 1024);
      if (resizedBuf.length < originalBuf.length) {
        console.log(`  リサイズ: ${sizeKB}KB → ${resizedKB}KB`);
      }

      // Step 3: Gemini API で解析（429リトライ付き）
      let text: string;
      try {
        text = await callGeminiWithRetry(model, PROMPT, resizedMime, resizedBase64);
      } catch (apiError) {
        const msg = apiError instanceof Error ? apiError.message : String(apiError);
        console.warn(`  スキップ（API エラー）: ${msg}`);
        continue;
      }

      // Step 4: レスポンスからJSONを抽出
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn(`  スキップ（JSONが見つからない）`);
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parsed: { products?: any[] };
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        console.warn(`  スキップ（JSON パースエラー）`);
        continue;
      }

      if (parsed.products && Array.isArray(parsed.products)) {
        for (const product of parsed.products) {
          // カテゴリのバリデーション
          if (!CATEGORIES.includes(product.category)) {
            product.category = "他";
          }
          // 価格の正規化
          if (product.price) {
            if (product.price.taxExcl && !product.price.taxIncl) {
              product.price.taxIncl = Math.round(
                product.price.taxExcl * 1.08
              );
            }
            if (product.price.taxIncl && !product.price.taxExcl) {
              product.price.taxExcl = Math.round(
                product.price.taxIncl / 1.08
              );
            }
          }
          allProducts.push(product);
        }
        console.log(`  → ${parsed.products.length}商品を抽出`);
      }

      // API レート制限回避: 画像間で 5〜10秒 待機
      if (idx < targetUrls.length - 1) {
        console.log(`  ${SLEEP_BETWEEN_IMAGES_MS / 1000}秒待機中...`);
        await sleep(SLEEP_BETWEEN_IMAGES_MS);
      }
    } catch (error) {
      // 予期しないエラーでも止めずに続行
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`  予期しないエラー（続行）: ${imageUrl} - ${msg}`);
    }
  }

  return allProducts;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error(
      "エラー: GEMINI_API_KEY が設定されていません。.env.local に設定してください。"
    );
    process.exit(1);
  }

  console.log(`使用キー: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`);
  const genAI = new GoogleGenerativeAI(apiKey);

  // Step 1: スクレイピング
  console.log("=== チラシ画像のスクレイピングを開始 ===");
  const storeFlyers = await scrapeAllStores();

  // クォータ回復のため60秒待機
  console.log("\n⏳ API クォータ回復のため60秒待機中...");
  await sleep(60000);

  // Step 2: AI解析
  console.log("\n=== AI解析を開始 ===");
  const stores: StoreProducts[] = [];

  for (const flyer of storeFlyers) {
    console.log(`\n${flyer.storeName} の解析:`);
    const products = await analyzeFlyer(genAI, flyer.storeName, flyer.imageUrls);
    stores.push({
      storeName: flyer.storeName,
      products,
      scrapedAt: new Date().toISOString(),
    });
    console.log(`  → ${products.length}商品を解析完了`);
  }

  // Step 3: 結果を保存
  const dailyPrices: DailyPrices = {
    date: new Date().toISOString().split("T")[0],
    stores,
  };

  const outputDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, "daily_prices.json");
  fs.writeFileSync(outputPath, JSON.stringify(dailyPrices, null, 2), "utf-8");

  console.log(`\n=== 完了 ===`);
  console.log(`結果を ${outputPath} に保存しました`);
  console.log(
    `合計: ${stores.reduce((sum, s) => sum + s.products.length, 0)} 商品`
  );
}

main().catch(console.error);
