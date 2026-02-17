"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import CategoryTabs, { type Category } from "./components/CategoryTabs";
import StoreFilter from "./components/StoreFilter";
import ProductCard from "./components/ProductCard";

/* ── 店舗アクセントカラー（控えめなドット用） ── */
const STORE_ACCENT: Record<string, string> = {
  "スーパーみらべる東十条店": "#4B7BE5",
  "スーパーみらべる十条店":   "#4B7BE5",
  "オーケー十条店":           "#E05555",
  "コモディイイダ東十条店":   "#3B9B6D",
  "サミット王子桜田通り店":   "#D97B2B",
  "業務スーパー王子店":       "#8B6FC0",
  "イオンスタイル赤羽店":     "#D4699C",
  "DCM東十条店":              "#A08B3A",
};

export function getStoreAccent(storeName: string): string {
  return STORE_ACCENT[storeName] || "#999";
}

/* ── お気に入りのlocalStorage管理 ── */
const FAV_KEY = "flyer-app-fav-stores";

function loadFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function saveFavorites(favs: Set<string>) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
  } catch { /* ignore */ }
}

/* ── Types ── */
interface Product {
  productName: string;
  price: { taxExcl: number | null; taxIncl: number | null };
  unit: string;
  category: string;
}

interface StoreProducts {
  storeName: string;
  products: Product[];
  scrapedAt: string;
}

interface DailyPrices {
  date: string;
  stores: StoreProducts[];
}

interface MergedProduct {
  productName: string;
  category: string;
  minTaxIncl: number | null;
  hasFavoriteStore: boolean;
  storePrices: {
    storeName: string;
    taxExcl: number | null;
    taxIncl: number | null;
    unit: string;
  }[];
}

const ITEMS_PER_PAGE = 30;

export default function MainView({ data }: { data: DailyPrices }) {
  const storeNames = data.stores.map((s) => s.storeName);
  const [selectedCategory, setSelectedCategory] = useState<Category>("すべて");
  const [selectedStores, setSelectedStores] = useState<Set<string>>(
    new Set(storeNames)
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [favoriteStores, setFavoriteStores] = useState<Set<string>>(new Set());

  // クライアントでlocalStorageから復元
  useEffect(() => {
    setFavoriteStores(loadFavorites());
  }, []);

  const toggleFavorite = useCallback((storeName: string) => {
    setFavoriteStores((prev) => {
      const next = new Set(prev);
      if (next.has(storeName)) {
        next.delete(storeName);
      } else {
        next.add(storeName);
      }
      saveFavorites(next);
      return next;
    });
  }, []);

  // 商品をマージ
  const mergedProducts = useMemo(() => {
    const map = new Map<string, MergedProduct>();

    for (const store of data.stores) {
      if (!selectedStores.has(store.storeName)) continue;

      for (const product of store.products) {
        const key = product.productName;
        if (!map.has(key)) {
          map.set(key, {
            productName: product.productName,
            category: product.category,
            minTaxIncl: null,
            hasFavoriteStore: false,
            storePrices: [],
          });
        }
        const entry = map.get(key)!;
        entry.storePrices.push({
          storeName: store.storeName,
          taxExcl: product.price.taxExcl,
          taxIncl: product.price.taxIncl,
          unit: product.unit,
        });
        if (product.price.taxIncl !== null) {
          if (entry.minTaxIncl === null || product.price.taxIncl < entry.minTaxIncl) {
            entry.minTaxIncl = product.price.taxIncl;
          }
        }
        if (favoriteStores.has(store.storeName)) {
          entry.hasFavoriteStore = true;
        }
      }
    }

    return Array.from(map.values());
  }, [data, selectedStores, favoriteStores]);

  // 検索 + カテゴリでフィルタリング
  const filtered = useMemo(() => {
    let result = mergedProducts;
    if (selectedCategory !== "すべて") {
      result = result.filter((p) => p.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((p) => p.productName.toLowerCase().includes(q));
    }
    return result;
  }, [mergedProducts, selectedCategory, searchQuery]);

  // カテゴリ別カウント
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of mergedProducts) {
      counts[p.category] = (counts[p.category] || 0) + 1;
    }
    return counts;
  }, [mergedProducts]);

  // ソート：お気に入り店舗の商品が先 → 安い順
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      // お気に入り店舗の商品を優先
      if (a.hasFavoriteStore !== b.hasFavoriteStore) {
        return a.hasFavoriteStore ? -1 : 1;
      }
      // 安い順
      if (a.minTaxIncl === null && b.minTaxIncl === null) return a.productName.localeCompare(b.productName, "ja");
      if (a.minTaxIncl === null) return 1;
      if (b.minTaxIncl === null) return -1;
      return a.minTaxIncl - b.minTaxIncl;
    });
  }, [filtered]);

  // ページネーション
  const totalPages = Math.max(1, Math.ceil(sorted.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedItems = sorted.slice(
    (safePage - 1) * ITEMS_PER_PAGE,
    safePage * ITEMS_PER_PAGE
  );

  const handleCategoryChange = useCallback((cat: Category) => {
    setSelectedCategory(cat);
    setCurrentPage(1);
  }, []);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  }, []);

  const toggleStore = useCallback((store: string) => {
    setSelectedStores((prev) => {
      const next = new Set(prev);
      if (next.has(store)) {
        next.delete(store);
      } else {
        next.add(store);
      }
      return next;
    });
    setCurrentPage(1);
  }, []);

  return (
    <div className="min-h-screen bg-white">
      {/* ヘッダー + 検索バー */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-800">
              チラシ最安値比較
            </h1>
            <span className="text-xs text-gray-400">
              {data.date} 更新
            </span>
          </div>
          {/* 検索バー */}
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="商品名で検索（キャベツ、豚肉、牛乳…）"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-3 pl-10 pr-10 text-base
                         focus:border-gray-400 focus:bg-white focus:outline-none
                         placeholder:text-gray-400 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); setCurrentPage(1); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-4 space-y-4">
        {/* お気に入り店舗の説明 */}
        {favoriteStores.size > 0 && (
          <div className="text-xs text-gray-400 flex items-center gap-1">
            <span className="text-red-400">♥</span>
            お気に入り店舗の商品が上位に表示されます
          </div>
        )}

        {/* 店舗フィルター */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            店舗
          </h2>
          <StoreFilter
            stores={storeNames}
            selected={selectedStores}
            onToggle={toggleStore}
            favoriteStores={favoriteStores}
            onToggleFavorite={toggleFavorite}
          />
        </section>

        {/* カテゴリタブ */}
        <section>
          <CategoryTabs
            selected={selectedCategory}
            onSelect={handleCategoryChange}
            counts={categoryCounts}
          />
        </section>

        {/* 件数表示 */}
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{sorted.length}件（安い順）</span>
          <span>{safePage} / {totalPages} ページ</span>
        </div>

        {/* 商品リスト */}
        <section className="space-y-2">
          {paginatedItems.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              該当する商品がありません
            </div>
          ) : (
            paginatedItems.map((product) => (
              <ProductCard
                key={product.productName}
                productName={product.productName}
                category={product.category}
                storePrices={product.storePrices}
                favoriteStores={favoriteStores}
                onToggleFavorite={toggleFavorite}
              />
            ))
          )}
        </section>

        {/* ページネーション */}
        {totalPages > 1 && (
          <nav className="flex items-center justify-center gap-2 py-6">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm
                         hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← 前へ
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
              .reduce<(number | string)[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("...");
                acc.push(p);
                return acc;
              }, [])
              .map((item, idx) =>
                typeof item === "string" ? (
                  <span key={`dots-${idx}`} className="px-1 text-gray-300">…</span>
                ) : (
                  <button
                    key={item}
                    onClick={() => setCurrentPage(item)}
                    className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                      item === safePage
                        ? "bg-gray-800 text-white"
                        : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {item}
                  </button>
                )
              )}
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm
                         hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              次へ →
            </button>
          </nav>
        )}

        <div className="pb-8" />
      </main>
    </div>
  );
}
