import { Response, NextFunction } from "express";
import { AppContextRequest } from "../types/appContext";
import jwt from "jsonwebtoken";
import { config } from "../configs";
import { Role } from "@prisma/client";
import { ApiResponse } from "../utils/apiResponse";

export interface AuthRequest extends AppContextRequest {
  user?: {
    id: string;
    phoneNo: string;
    role: Role;
  };
}

export const auth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Access Denied: No Token Provided" });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as any;
    req.user = decoded;

    // ============================================================
    // Rolling 30-day access token extension
    // ============================================================
    const now = Math.floor(Date.now() / 1000);
    const exp = decoded.exp;
    const iat = decoded.iat;
    
    // Total lifespan of the token in seconds
    const lifespan = exp - iat;
    // Remaining lifespan
    const remaining = exp - now;

    // Re-issue if less than 50% lifespan remains (15 days for a 30-day token)
    if (remaining < lifespan / 2) {
      const newAccessToken = jwt.sign(
        { id: decoded.id, phoneNo: decoded.phoneNo, role: decoded.role },
        config.jwt.secret as jwt.Secret,
        { expiresIn: config.jwt.accessExpiry as any }
      );
      // Send the fresh token in a header
      res.setHeader("x-new-access-token", newAccessToken);
      // Also allow cross-origin clients to see this header
      res.setHeader("Access-Control-Expose-Headers", "x-new-access-token");
    }

    return next();
  } catch (err) {
    return res.status(401).json(ApiResponse.error(res, 401, "Invalid or Expired Token"));
  }
};

export { auth as authenticate };
