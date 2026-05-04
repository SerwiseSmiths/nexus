import { Router } from "express";
import { AddressController } from "../controllers/address.controller";

const router = Router();

// Public — no auth needed (used for search suggestions)
router.get("/autocomplete", AddressController.autocomplete);

export default router;
