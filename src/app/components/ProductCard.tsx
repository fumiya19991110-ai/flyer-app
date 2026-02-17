"use client";

import { getStoreAccent } from "../MainView";
import type { StorePrice } from "../MainView";

interface ProductCardProps {
  productName: string;
  category: string;
  storePrices: StorePrice[];
  favoriteStores: Set<string>;
  onToggleFavorite: (storeName: string) => void;
}

/** "2026-02-17" → "2/17" */
function shortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 有効期間のラベルを生成 */
function validLabel(from: string | null, to: string | null): string | null {
  if (!from && !to) return null;
  if (from && to) {
    if (from === to) return `${shortDate(from)}のみ`;
    return `${shortDate(from)}〜${shortDate(to)}`;
  }
  if (to) return `〜${shortDate(to)}まで`;
  if (from) return `${shortDate(from)}〜`;
  return null;
}

/** 今日の日付を YYYY-MM-DD で返す */
function todayStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function ProductCard({
  productName,
  category,
  storePrices,
  favoriteStores,
  onToggleFavorite,
}: ProductCardProps) {
  const today = todayStr();

  const validPrices = storePrices.filter((sp) => sp.taxIncl !== null);
  const minPrice =
    validPrices.length > 0
      ? Math.min(...validPrices.map((sp) => sp.taxIncl!))
      : null;

  // 価格の安い順にソート
  const sorted = [...storePrices].sort((a, b) => {
    if (a.taxIncl === null) return 1;
    if (b.taxIncl === null) return -1;
    return a.taxIncl - b.taxIncl;
  });

  return (
    <div className="rounded-lg bg-white border border-gray-150 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <h3 className="font-semibold text-gray-800 text-sm">{productName}</h3>
        <span className="text-[11px] text-gray-400">{category}</span>
      </div>

      <div className="px-3 pb-3 space-y-1">
        {sorted.map((sp) => {
          const isCheapest = sp.taxIncl === minPrice && minPrice !== null;
          const isFav = favoriteStores.has(sp.storeName);
          const accent = getStoreAccent(sp.storeName);
          const expired = sp.validTo ? sp.validTo < today : false;
          const label = validLabel(sp.validFrom, sp.validTo);

          return (
            <div
              key={sp.storeName}
              className={`flex items-center justify-between rounded-md px-3 py-2 ${
                expired
                  ? "bg-gray-50 opacity-50"
                  : isCheapest
                    ? "bg-gray-50"
                    : "bg-white"
              }`}
            >
              {/* 左: ドット + 店舗名 + ハート + 期間 */}
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <span
                  className="inline-block h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: accent }}
                />
                <span className={`text-sm truncate ${isCheapest && !expired ? "text-gray-800 font-medium" : "text-gray-500"}`}>
                  {sp.storeName}
                </span>
                <button
                  onClick={() => onToggleFavorite(sp.storeName)}
                  className={`shrink-0 text-sm leading-none transition-colors ${
                    isFav ? "text-red-400" : "text-gray-200 hover:text-red-300"
                  }`}
                  aria-label={isFav ? "お気に入り解除" : "お気に入りに追加"}
                >
                  {isFav ? "♥" : "♡"}
                </button>
                {/* 有効期間ラベル */}
                {label && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    expired
                      ? "bg-gray-200 text-gray-400 line-through"
                      : "bg-gray-100 text-gray-500"
                  }`}>
                    {expired ? "終了" : label}
                  </span>
                )}
              </div>

              {/* 右: 価格 */}
              <div className="text-right flex items-baseline gap-1 shrink-0 ml-2">
                <span className={`text-lg font-extrabold tabular-nums ${expired ? "text-gray-400" : "text-red-600"}`}>
                  ¥{sp.taxIncl?.toLocaleString() ?? "---"}
                </span>
                {sp.taxExcl !== null && (
                  <span className="text-[11px] text-gray-400">
                    (税抜¥{sp.taxExcl.toLocaleString()})
                  </span>
                )}
                {sp.unit && (
                  <span className="text-[11px] text-gray-400">
                    /{sp.unit}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
