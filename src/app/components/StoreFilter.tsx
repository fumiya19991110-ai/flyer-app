"use client";

import { getStoreAccent } from "../MainView";

interface StoreFilterProps {
  stores: string[];
  selected: Set<string>;
  onToggle: (store: string) => void;
  favoriteStores: Set<string>;
  onToggleFavorite: (store: string) => void;
}

export default function StoreFilter({
  stores,
  selected,
  onToggle,
  favoriteStores,
  onToggleFavorite,
}: StoreFilterProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {stores.map((store) => {
        const isActive = selected.has(store);
        const isFav = favoriteStores.has(store);
        const accent = getStoreAccent(store);

        return (
          <div key={store} className="flex items-center gap-0.5">
            <label
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm border transition-colors ${
                isActive
                  ? "bg-white text-gray-700 border-gray-300"
                  : "bg-gray-50 text-gray-400 border-gray-200 line-through"
              }`}
            >
              <input
                type="checkbox"
                checked={isActive}
                onChange={() => onToggle(store)}
                className="sr-only"
              />
              {/* アクセントドット */}
              <span
                className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: isActive ? accent : "#ccc" }}
              />
              {store}
            </label>
            {/* お気に入りハート */}
            <button
              onClick={() => onToggleFavorite(store)}
              className={`text-sm leading-none transition-colors px-1 ${
                isFav ? "text-red-400" : "text-gray-300 hover:text-red-300"
              }`}
              aria-label={isFav ? `${store}のお気に入り解除` : `${store}をお気に入りに追加`}
            >
              {isFav ? "♥" : "♡"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
