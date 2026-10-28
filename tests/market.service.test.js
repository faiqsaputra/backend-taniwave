import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketPrices, findMatchingDemands } from "../src/services/market.service.js";

test("market price output maps to dashboard card fields and calculates trend", () => {
  const prices = buildMarketPrices([
    { commodity: "Cabai", price: "48500", unit: "kg", location: "Jepara", source: "demo", isDemo: true, observedAt: new Date("2026-10-22T09:00:00Z") },
    { commodity: "Cabai", price: "45000", unit: "kg", location: "Jepara", source: "demo", isDemo: true, observedAt: new Date("2026-10-21T09:00:00Z") }
  ]);

  assert.equal(prices.length, 1);
  assert.equal(prices[0].name, "Cabai");
  assert.equal(prices[0].priceAmount, 48500);
  assert.equal(prices[0].trend, "up");
  assert.match(prices[0].change, /^\+/);
  assert.equal(prices[0].isDemo, true);
});

test("demand matcher matches commodity, stock, grade, price and location", () => {
  const matches = findMatchingDemands({
    listings: [{ id: "listing-1", title: "Cabai Grade B", commodity: "Cabai", quantity: 20, unit: "kg", price: "25000", quality: "B", location: "Jepara" }],
    demands: [{ id: "demand-1", commodity: "cabai", minQuantity: 15, maxQuantity: 20, unit: "kg", quality: "B", maxPrice: "30000", location: "Jepara", status: "OPEN", buyer: { name: "UMKM" } }]
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].buyerName, "UMKM");
  assert.equal(matches[0].listingId, "listing-1");
});

test("demand matcher rejects listings above buyer's maximum price", () => {
  const matches = findMatchingDemands({
    listings: [{ id: "listing-1", title: "Cabai", commodity: "Cabai", quantity: 20, unit: "kg", price: "35000", quality: "A", location: "Jepara" }],
    demands: [{ id: "demand-1", commodity: "Cabai", minQuantity: 10, unit: "kg", maxPrice: "30000", status: "OPEN", buyer: { name: "Pembeli" } }]
  });

  assert.equal(matches.length, 0);
});
