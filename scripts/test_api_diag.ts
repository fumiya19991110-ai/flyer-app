/**
 * API キー診断スクリプト
 * Step 1: モデル一覧取得（キー自体の有効性）
 * Step 2: テキストのみ生成（Billing紐付け確認）
 * Step 3: 画像付き生成（本番同等テスト）
 */
import * as fs from "fs";
import * as path from "path";

// .env.local 読み込み
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error("GEMINI_API_KEY が未設定"); process.exit(1); }

// キーの先頭/末尾だけ表示
console.log(`API Key: ${API_KEY.substring(0, 6)}...${API_KEY.substring(API_KEY.length - 4)}`);
console.log();

async function main() {
  // ===== Step 1: モデル一覧（REST直接呼び出し） =====
  console.log("=== Step 1: モデル一覧取得 ===");
  try {
    const listRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`
    );
    if (!listRes.ok) {
      const body = await listRes.text();
      console.error(`❌ HTTP ${listRes.status}: ${body.substring(0, 300)}`);
      return;
    }
    const listData = await listRes.json() as { models: { name: string; supportedGenerationMethods: string[] }[] };
    const flashModels = listData.models
      .filter((m: { name: string }) => m.name.includes("flash") || m.name.includes("2.0"))
      .map((m: { name: string; supportedGenerationMethods: string[] }) => `${m.name} [${m.supportedGenerationMethods.join(",")}]`);
    console.log("✅ キーは有効。Flash系モデル:");
    flashModels.forEach((m: string) => console.log(`  - ${m}`));
  } catch (err) {
    console.error("❌ ネットワークエラー:", err instanceof Error ? err.message : err);
    return;
  }

  // ===== Step 2: テキストのみ生成 =====
  console.log("\n=== Step 2: テキスト生成テスト (gemini-2.0-flash) ===");
  const textPayload = {
    contents: [{ parts: [{ text: "1+1は？数字だけ答えて" }] }],
  };

  for (const apiVer of ["v1beta", "v1"]) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/${apiVer}/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(textPayload) }
      );
      const body = await res.json();
      if (res.ok) {
        const answer = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "(空)";
        console.log(`✅ ${apiVer}: 成功 → "${answer.trim()}"`);
        break;
      } else {
        const errMsg = body.error?.message ?? JSON.stringify(body).substring(0, 200);
        console.log(`❌ ${apiVer}: HTTP ${res.status} → ${errMsg.substring(0, 150)}`);
      }
    } catch (err) {
      console.error(`❌ ${apiVer}: ネットワークエラー:`, err instanceof Error ? err.message : err);
    }
  }

  // ===== Step 3: 使えるモデル名を探す =====
  console.log("\n=== Step 3: 各モデルでテキスト生成テスト ===");
  const modelsToTry = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash-001",
    "gemini-1.5-flash-002",
  ];

  for (const modelName of modelsToTry) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(textPayload) }
      );
      const status = res.status;
      if (res.ok) {
        const body = await res.json();
        const answer = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "(空)";
        console.log(`  ✅ ${modelName}: 成功 → "${answer.trim()}"`);
      } else {
        const body = await res.json();
        const code = body.error?.status ?? status;
        const short = body.error?.message?.substring(0, 80) ?? "";
        console.log(`  ❌ ${modelName}: ${code} ${short}`);
      }
    } catch {
      console.log(`  ❌ ${modelName}: ネットワークエラー`);
    }
    // レート制限回避
    await new Promise(r => setTimeout(r, 1000));
  }
}

main().catch(console.error);
