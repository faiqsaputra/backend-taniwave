import { Router } from "express";
import {
  listMarketPrices, listListings, createListing, updateListing,
  listDemands, createDemand, updateDemandStatus
} from "../controllers/market.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();
router.use(requireAuth);
router.get("/prices", listMarketPrices);
router.get("/listings", listListings);
router.post("/listings", createListing);
router.patch("/listings/:listingId", updateListing);
router.get("/demands", listDemands);
router.post("/demands", createDemand);
router.patch("/demands/:demandId/status", updateDemandStatus);

export default router;
