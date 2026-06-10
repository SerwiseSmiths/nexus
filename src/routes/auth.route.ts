import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";

const router = Router();

/**
 * @swagger
 * /auth/request-otp:
 *   post:
 *     summary: Request OTP for login
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phoneNo]
 *             properties:
 *               phoneNo:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP sent successfully
 */
router.post("/request-otp", AuthController.requestOtp);

/**
 * @swagger
 * /auth/verify-otp:
 *   post:
 *     summary: Verify OTP and login
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phoneNo, otp]
 *             properties:
 *               phoneNo:
 *                 type: string
 *               otp:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [PROVIDER, CUSTOMER, ADMIN]
 *     responses:
 *       200:
 *         description: Login successful
 */
router.post("/verify-otp", AuthController.verifyOtp);

/**
 * @swagger
 * /auth/refresh-token:
 *   post:
 *     summary: Refresh access token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 */
router.post("/refresh-token", AuthController.refreshToken);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post("/logout", AuthController.logout);

// ── Provider (Radix) auth ─────────────────────────────────────────────────
// These routes only work for existing PROVIDER accounts — no user creation.

/**
 * @swagger
 * /auth/provider/request-otp:
 *   post:
 *     summary: Request OTP for provider login (Radix app — existing PROVIDER accounts only)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phoneNo]
 *             properties:
 *               phoneNo:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       403:
 *         description: Number is not registered as a professional
 */
router.post("/provider/request-otp", AuthController.providerRequestOtp);

/**
 * @swagger
 * /auth/provider/verify-otp:
 *   post:
 *     summary: Verify OTP for provider login (Radix app — does not create new users)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phoneNo, otp]
 *             properties:
 *               phoneNo:
 *                 type: string
 *               otp:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       400:
 *         description: Invalid or expired OTP
 *       403:
 *         description: Provider account not found
 */
router.post("/provider/verify-otp", AuthController.providerVerifyOtp);

export default router;
