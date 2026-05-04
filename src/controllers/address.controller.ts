import { Response, NextFunction, Request } from "express";
import { z } from "zod";
import { AuthRequest } from "../middlewares/auth.middleware";
import { AddressService } from "../services/address.service";
import { autocompleteAddress } from "../services/geocode.service";
import { ApiResponse } from "../utils/apiResponse";

const createSchema = z.object({
  title: z.string().optional(),
  houseNo: z.string().min(1, "House number is required"),
  societyName: z.string().min(1, "Society name is required"),
  addressLineOne: z.string().optional(),
  addressLineTwo: z.string().optional(),
  area: z.string().optional(),
  pinCode: z.string().length(6, "Pin code must be 6 digits"),
  city: z.string().min(1, "City is required"),
  state: z.string().optional(),
  country: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
});

const updateSchema = createSchema.partial();

export class AddressController {
  static async autocomplete(req: Request, res: Response, next: NextFunction) {
    try {
      const input = req.query.input as string;
      if (!input || input.trim().length < 3) {
        return ApiResponse.success(res, 200, "Too short", { predictions: [] });
      }
      const predictions = await autocompleteAddress(input);
      return ApiResponse.success(res, 200, "Predictions fetched", { predictions });
    } catch (error) {
      next(error);
    }
  }

  static async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return ApiResponse.error(res, 400, parsed.error.issues[0].message);
      }

      const address = await AddressService.create(req.user!.id, parsed.data);
      return ApiResponse.success(res, 201, "Address created successfully", { address });
    } catch (error) {
      next(error);
    }
  }

  static async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const addresses = await AddressService.getAllByUser(req.user!.id);
      return ApiResponse.success(res, 200, "Addresses fetched successfully", { addresses });
    } catch (error) {
      next(error);
    }
  }

  static async getOne(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const address = await AddressService.getById(id, req.user!.id);
      if (!address) {
        return ApiResponse.error(res, 404, "Address not found");
      }
      return ApiResponse.success(res, 200, "Address fetched successfully", { address });
    } catch (error) {
      next(error);
    }
  }

  static async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return ApiResponse.error(res, 400, parsed.error.issues[0].message);
      }

      const id = req.params.id as string;
      const address = await AddressService.update(id, req.user!.id, parsed.data);
      if (!address) {
        return ApiResponse.error(res, 404, "Address not found");
      }
      return ApiResponse.success(res, 200, "Address updated successfully", { address });
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const address = await AddressService.delete(id, req.user!.id);
      if (!address) {
        return ApiResponse.error(res, 404, "Address not found");
      }
      return ApiResponse.success(res, 200, "Address deleted successfully");
    } catch (error) {
      next(error);
    }
  }
}
