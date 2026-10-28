const gradeRank = { C: 1, B: 2, A: 3 };

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("id-ID").replace(/\s+/g, " ");
}

function sameCommodity(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function compatibleLocation(demandLocation, listingLocation) {
  if (!demandLocation || !listingLocation) return true;
  const demand = normalize(demandLocation);
  const listing = normalize(listingLocation);
  return demand === listing || demand.includes(listing) || listing.includes(demand);
}

function asNumber(value) {
  if (value == null) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0
  }).format(value);
}

function commodityIcon(commodity) {
  const name = normalize(commodity);
  if (name.includes("cabai") || name.includes("cabe")) return "🌶️";
  if (name.includes("tomat")) return "🍅";
  if (name.includes("bawang")) return "🧅";
  if (name.includes("jagung")) return "🌽";
  return "🌱";
}

export function buildMarketPrices(snapshots) {
  const byCommodity = new Map();
  for (const row of snapshots) {
    const key = `${normalize(row.commodity)}|${normalize(row.location)}`;
    const rows = byCommodity.get(key) || [];
    rows.push(row);
    byCommodity.set(key, rows);
  }

  const latest = [];
  for (const rows of byCommodity.values()) {
    rows.sort((a, b) => new Date(b.observedAt) - new Date(a.observedAt));
    const current = rows[0];
    const previous = rows[1];
    const price = asNumber(current.price);
    const previousPrice = asNumber(previous?.price);
    const changePct = previousPrice && previousPrice !== 0 && price != null
      ? Number((((price - previousPrice) / previousPrice) * 100).toFixed(1))
      : null;

    latest.push({
      commodity: current.commodity,
      name: current.commodity,
      priceAmount: price,
      price: price == null ? null : formatRupiah(price),
      displayPrice: price == null ? null : formatRupiah(price),
      unit: current.unit,
      location: current.location,
      changePct,
      change: changePct == null ? "—" : `${changePct > 0 ? "+" : ""}${changePct.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`,
      trend: changePct == null || changePct === 0 ? "flat" : changePct > 0 ? "up" : "down",
      icon: commodityIcon(current.commodity),
      source: current.source,
      isDemo: current.isDemo,
      observedAt: current.observedAt
    });
  }
  return latest.sort((a, b) => a.commodity.localeCompare(b.commodity, "id-ID")).slice(0, 8);
}

export function findMatchingDemands({ listings, demands }) {
  const now = new Date();
  const matches = [];
  for (const demand of demands) {
    if (demand.needBy && new Date(demand.needBy) < now) continue;

    const listing = listings.find((item) => {
      if (!sameCommodity(item.commodity, demand.commodity)) return false;
      if (normalize(item.unit) !== normalize(demand.unit)) return false;
      if (demand.minQuantity != null && item.quantity < demand.minQuantity) return false;
      if (demand.maxPrice != null && item.price != null && Number(item.price) > Number(demand.maxPrice)) return false;
      if (demand.quality && (!item.quality || gradeRank[item.quality] < gradeRank[demand.quality])) return false;
      if (!compatibleLocation(demand.location, item.location)) return false;
      return true;
    });

    if (listing) {
      matches.push({
        demandId: demand.id,
        commodity: demand.commodity,
        minQuantity: demand.minQuantity,
        maxQuantity: demand.maxQuantity,
        unit: demand.unit,
        quality: demand.quality,
        maxPrice: asNumber(demand.maxPrice),
        location: demand.location,
        needBy: demand.needBy,
        listingId: listing.id,
        listingTitle: listing.title,
        availableQuantity: listing.quantity,
        listingPrice: asNumber(listing.price),
        buyerName: demand.buyer?.name || "Pembeli"
      });
    }
  }
  return matches;
}
