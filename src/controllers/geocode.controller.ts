import { Request, Response, NextFunction } from "express";
import { autocompleteAddress } from "../services/geocode.service";
import { ApiResponse } from "../utils/apiResponse";

export class GeocodeController {
  static async autocomplete(req: Request, res: Response, next: NextFunction) {
    try {
      const { input } = req.query;

      if (!input || typeof input !== "string" || !input.trim()) {
        return ApiResponse.error(res, 400, "input query param is required");
      }

      const predictions = await autocompleteAddress(input.trim());
      return ApiResponse.success(res, 200, "Predictions fetched", { predictions });
    } catch (error: any) {
      next(error);
    }
  }
}
