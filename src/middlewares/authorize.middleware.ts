import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth.middleware";
import { Role } from "@prisma/client";
import { ApiResponse } from "../utils/apiResponse";

export const authorize = (roles: Role[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json(ApiResponse.error(res, 403, "Forbidden: Insufficient permissions"));
    }

    return next();
  };
};
