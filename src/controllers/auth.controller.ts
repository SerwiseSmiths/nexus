import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { Role } from "@prisma/client";
import { ApiResponse } from "../utils/apiResponse";

export class AuthController {
  static async requestOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { phoneNo } = req.body;
      if (!phoneNo) {
        return ApiResponse.error(res, 400, "Phone number is required");
      }

      await AuthService.generateOtp(phoneNo);
      return ApiResponse.success(res, 200, "OTP sent successfully");
    } catch (error: any) {
      next(error);
    }
  }

  static async verifyOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { phoneNo, otp, role } = req.body;
      if (!phoneNo || !otp) {
        return ApiResponse.error(res, 400, "Phone number and OTP are required");
      }

      const result = await AuthService.verifyOtp(phoneNo, otp, role as Role);
      return ApiResponse.success(res, 200, "Login successful", result);
    } catch (error: any) {
      next(error);
    }
  }

  static async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        return ApiResponse.error(res, 400, "Refresh token is required");
      }

      const result = await AuthService.refreshAccessToken(refreshToken);
      return ApiResponse.success(res, 200, "Token refreshed successfully", result);
    } catch (error: any) {
      next(error);
    }
  }

  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      if (refreshToken) {
        await AuthService.logout(refreshToken);
      }
      return ApiResponse.success(res, 200, "Logged out successfully");
    } catch (error: any) {
      next(error);
    }
  }
}
