"use client";

const CATEGORIES = [
  "すべて",
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

interface CategoryTabsProps {
  selected: Category;
  onSelect: (category: Category) => void;
  counts: Record<string, number>;
}

export default function CategoryTabs({
  selected,
  onSelect,
  counts,
}: CategoryTabsProps) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-hide">
      {CATEGORIES.map((cat) => {
        const count = cat === "すべて" ? undefined : counts[cat] || 0;
        const isActive = selected === cat;
        return (
          <button
            key={cat}
            onClick={() => onSelect(cat)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm transition-colors ${
              isActive
                ? "bg-gray-800 text-white"
                : "bg-white text-gray-500 hover:bg-gray-100 border border-gray-200"
            }`}
          >
            {cat}
            {count !== undefined && (
              <span
                className={`ml-1 text-xs ${isActive ? "text-gray-400" : "text-gray-400"}`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
