import { Router } from "express";
import { GeocodeController } from "../controllers/geocode.controller";

const router = Router();

// GET /api/geocode?input=<address string>
// Note: auth temporarily removed for UI testing
router.get("/", GeocodeController.autocomplete);

export default router;
