import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth.middleware";
import { Role } from "@prisma/client";
import { ApiResponse } from "../utils/apiResponse";

export const authorize = (roles: Role[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return ApiResponse.error(res, 401, "Please log in to continue");
    }

    if (!roles.includes(req.user.role)) {
      return ApiResponse.error(res, 403, "You don't have permission to perform this action");
    }

    return next();
  };
};
