import { chromium, type Browser, type Page } from "playwright";

export interface StoreFlyer {
  storeName: string;
  source: string;
  imageUrls: string[];
}

interface StoreConfig {
  name: string;
  url: string;
  type: "kurashiru" | "tokubai" | "shufoo";
}

const STORES: StoreConfig[] = [
  {
    name: "スーパーみらべる東十条店",
    url: "https://chirashi.kurashiru.com/stores/3836e998-39a3-462d-a0d0-40eba62a0046",
    type: "kurashiru",
  },
  {
    name: "コモディイイダ東十条店",
    url: "https://tokubai.co.jp/%E3%82%B3%E3%83%A2%E3%83%87%E3%82%A3%E3%82%A4%E3%82%A4%E3%83%80/7547",
    type: "tokubai",
  },
  {
    name: "サミット王子桜田通り店",
    url: "https://tokubai.co.jp/%E3%82%B5%E3%83%9F%E3%83%83%E3%83%88/81738",
    type: "tokubai",
  },
  {
    name: "スーパーみらべる十条店",
    url: "https://chirashi.kurashiru.com/stores/145cc4cb-df2f-40eb-af71-d781622c0f4a",
    type: "kurashiru",
  },
  {
    name: "オーケー十条店",
    url: "https://chirashi.kurashiru.com/stores/43344c79-4ca2-41cb-8d77-c217156d60ef",
    type: "kurashiru",
  },
  {
    name: "業務スーパー王子店",
    url: "https://chirashi.kurashiru.com/stores/f851643f-efe0-45de-a7b8-98263d6130b8",
    type: "kurashiru",
  },
  {
    name: "イオンスタイル赤羽店",
    url: "https://chirashi.kurashiru.com/stores/92d7d7a8-f768-404a-bb91-b5dba21e7b34",
    type: "kurashiru",
  },
  {
    name: "DCM東十条店",
    url: "https://chirashi.kurashiru.com/stores/596f33b5-8461-4f14-941d-af83a271ea1b",
    type: "kurashiru",
  },
];

async function scrapeKurashiru(page: Page, url: string): Promise<string[]> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  // 画像が描画されるまで少し待つ
  await page.waitForTimeout(3000);

  // クリック可能なチラシサムネイルがあればクリックして拡大画像を取得
  const flyerLinks = page.locator('a[href*="/flyers/"]');
  const linkCount = await flyerLinks.count();

  const imageUrls: string[] = [];

  if (linkCount > 0) {
    // 最初のチラシリンクをクリックして詳細ページへ
    const firstLink = flyerLinks.first();
    const href = await firstLink.getAttribute("href");
    if (href) {
      const flyerUrl = href.startsWith("http")
        ? href
        : `https://chirashi.kurashiru.com${href}`;
      await page.goto(flyerUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3000);

      // チラシ詳細ページからすべての画像を取得
      const images = page.locator("img");
      const imgCount = await images.count();
      for (let i = 0; i < imgCount; i++) {
        const img = images.nth(i);
        const src = await img.getAttribute("src");
        if (
          src &&
          (src.includes("chirashi") ||
            src.includes("flyer") ||
            src.includes("image")) &&
          !src.includes("logo") &&
          !src.includes("icon") &&
          !src.includes("avatar") &&
          (src.includes(".jpg") ||
            src.includes(".jpeg") ||
            src.includes(".png") ||
            src.includes(".webp"))
        ) {
          // 500px以上の画像のみ対象（極小画像を除外）
          const dims = await img.evaluate((el: HTMLImageElement) => ({
            w: el.naturalWidth,
            h: el.naturalHeight,
          }));
          if (dims.w < 500 && dims.h < 500) continue;

          const fullUrl = src.startsWith("http")
            ? src
            : `https://chirashi.kurashiru.com${src}`;
          imageUrls.push(fullUrl);
        }
      }
    }
  }

  // フォールバック: 詳細ページに遷移できなかった場合、一覧ページの画像を取得
  if (imageUrls.length === 0) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);
    const images = page.locator("img");
    const imgCount = await images.count();
    for (let i = 0; i < imgCount; i++) {
      const img = images.nth(i);
      const src = await img.getAttribute("src");
      if (
        src &&
        !src.includes("logo") &&
        !src.includes("icon") &&
        !src.includes("avatar") &&
        !src.includes("svg") &&
        (src.includes(".jpg") ||
          src.includes(".jpeg") ||
          src.includes(".png") ||
          src.includes(".webp"))
      ) {
        // 500px以上の画像のみ対象
        const dims = await img.evaluate((el: HTMLImageElement) => ({
          w: el.naturalWidth,
          h: el.naturalHeight,
        }));
        if (dims.w < 500 && dims.h < 500) continue;

        const fullUrl = src.startsWith("http")
          ? src
          : `https://chirashi.kurashiru.com${src}`;
        imageUrls.push(fullUrl);
      }
    }
  }

  return [...new Set(imageUrls)];
}

async function scrapeTokubai(page: Page, url: string): Promise<string[]> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  const imageUrls: string[] = [];

  // tokubaiのチラシ画像: flyer_image クラスやチラシセクション内の大きな画像を狙う
  // チラシ画像は通常 img タグで、srcに "leaflet" や "flyer" または画像CDN のパスを含む
  const allImages = page.locator("img");
  const allCount = await allImages.count();

  for (let i = 0; i < allCount; i++) {
    const img = allImages.nth(i);
    const src =
      (await img.getAttribute("src")) ||
      (await img.getAttribute("data-src"));

    if (!src) continue;

    // バナー・アイコン・ロゴ等を除外
    const excludePatterns = [
      "logo", "icon", "avatar", "svg", "badge", "banner",
      "button", "arrow", "sprite", "emoji", "ad_",
      "advertisement", "campaign", "coupon", "stamp",
      "profile", "user", "thumb_small",
    ];
    if (excludePatterns.some((pat) => src.toLowerCase().includes(pat))) continue;

    // 画像の実際のサイズを取得してフィルタリング
    const dimensions = await img.evaluate((el: HTMLImageElement) => ({
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
      displayWidth: el.getBoundingClientRect().width,
      displayHeight: el.getBoundingClientRect().height,
    }));

    // チラシ画像は通常大きい（幅500px以上 or 高さ500px以上）
    const isLargeEnough =
      dimensions.naturalWidth >= 500 ||
      dimensions.naturalHeight >= 500 ||
      dimensions.displayWidth >= 500 ||
      dimensions.displayHeight >= 500;

    if (!isLargeEnough) continue;

    // アスペクト比チェック: バナーは極端に横長（幅/高さ > 4）なので除外
    const aspect = dimensions.naturalWidth / (dimensions.naturalHeight || 1);
    if (aspect > 4 || aspect < 0.2) continue;

    const fullUrl = src.startsWith("http")
      ? src
      : `https://tokubai.co.jp${src}`;
    imageUrls.push(fullUrl);
  }

  return [...new Set(imageUrls)];
}

export async function scrapeAllStores(): Promise<StoreFlyer[]> {
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const results: StoreFlyer[] = [];

  for (const store of STORES) {
    console.log(`スクレイピング中: ${store.name} (${store.type})`);
    try {
      let imageUrls: string[] = [];

      if (store.type === "kurashiru") {
        imageUrls = await scrapeKurashiru(page, store.url);
      } else if (store.type === "tokubai") {
        imageUrls = await scrapeTokubai(page, store.url);
      }

      results.push({
        storeName: store.name,
        source: store.url,
        imageUrls,
      });

      console.log(`  → ${imageUrls.length}枚の画像を取得`);
    } catch (error) {
      console.error(`  → エラー: ${store.name}`, error);
      results.push({
        storeName: store.name,
        source: store.url,
        imageUrls: [],
      });
    }

    // 店舗間の待機時間（2秒）
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  await browser.close();
  return results;
}

// 直接実行時
if (require.main === module) {
  scrapeAllStores().then((results) => {
    console.log(JSON.stringify(results, null, 2));
  });
}
