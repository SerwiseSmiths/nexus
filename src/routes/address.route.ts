import { Router } from "express";
import { AddressController } from "../controllers/address.controller";
import { auth } from "../middlewares/auth.middleware";

const router = Router();

// Public — no auth needed (used for search suggestions / geocoding)
router.get("/autocomplete", AddressController.autocomplete);
router.get("/reverse-geocode", AddressController.reverseGeocode);

// Authenticated CRUD
router.get("/", auth, AddressController.getAll);
router.post("/", auth, AddressController.create);
router.get("/:id", auth, AddressController.getOne);
router.patch("/:id", auth, AddressController.update);
router.delete("/:id", auth, AddressController.remove);

export default router;
