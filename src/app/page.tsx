import fs from "fs";
import path from "path";
import MainView from "./MainView";

interface Product {
  productName: string;
  price: { taxExcl: number | null; taxIncl: number | null };
  unit: string;
  category: string;
  validFrom: string | null;
  validTo: string | null;
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

function loadPrices(): DailyPrices {
  const filePath = path.join(process.cwd(), "data", "daily_prices.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

export default function Home() {
  const data = loadPrices();
  return <MainView data={data} />;
}
