import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config } from "../configs";
import prisma from "./prisma.service";
import { sendWhatsAppText } from "./msg91.service";
import { Role, NotificationType, WalletLedgerSource } from "@prisma/client";
import { NotificationService } from '@/services/notification.service';
import { ApiError } from "../utils/apiResponse";
import { generateUniqueReferralCode } from "../utils/referralCode";
import { StrapiService } from '@/services/strapi.service';
import { WalletService } from '@/services/wallet.service';

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

const TEST_PHONES: Record<string, string> = {
  "1234567890": "123456",
  "9112345678": "123456",
};

export class AuthService {
  static async generateOtp(phoneNo: string) {
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    // Hash OTP for storage
    const salt = await bcrypt.genSalt(10);
    const hashedOtp = await bcrypt.hash(otpCode, salt);

    // Upsert OTP record
    await prisma.otp.upsert({
      where: { phoneNo },
      update: {
        otp: hashedOtp,
        expiresAt,
        attempts: 0,
      },
      create: {
        phoneNo,
        otp: hashedOtp,
        expiresAt,
      },
    });

    // Send via Msg91 if not a test phone
    if (phoneNo in TEST_PHONES) {
      console.log(`[TEST] OTP for ${phoneNo}: ${TEST_PHONES[phoneNo]}`);
    } else {
      await sendWhatsAppText({
        recipientNumber: phoneNo,
        text: otpCode,
      });
    }

    return { ttlMinutes: OTP_TTL_MINUTES };
  }

  static async verifyOtp(phoneNo: string, otp: string, role: Role = Role.CUSTOMER) {
    const record = await prisma.otp.findUnique({ where: { phoneNo } });

    if (!record) {
      throw new Error("OTP not found or expired");
    }

    if (record.expiresAt < new Date()) {
      await prisma.otp.delete({ where: { phoneNo } });
      throw new Error("OTP expired");
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      throw new Error("Maximum OTP attempts exceeded");
    }

    const isMatch = (phoneNo in TEST_PHONES && otp === TEST_PHONES[phoneNo]) ||
      (await bcrypt.compare(otp, record.otp));

    if (!isMatch) {
      await prisma.otp.update({
        where: { phoneNo },
        data: { attempts: { increment: 1 } },
      });
      throw new Error("Invalid OTP");
    }

    // OTP verified, delete it
    await prisma.otp.delete({ where: { phoneNo } });

    // Find or create user
    let user = await prisma.user.findUnique({ where: { phoneNo } });
    const isNewUser = !user;

    if (!user) {
      const referralCode = await generateUniqueReferralCode();
      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { phoneNo, role, referralCode },
        });
        await tx.wallet.create({ data: { userId: created.id } });
        return created;
      });
    } else if (!user.referralCode) {
      const referralCode = await generateUniqueReferralCode();
      await prisma.user.update({ where: { id: user.id }, data: { referralCode } });
      user = { ...user, referralCode };
    }

    // Credit welcome bonus for new users if the feature is enabled in CMS
    if (isNewUser) {
      const bonus = await StrapiService.fetchWelcomeBonus().catch(() => null);
      if (bonus?.isEnabled && bonus.amount > 0) {
        await WalletService.creditWallet({
          userId: user.id,
          amount: bonus.amount,
          source: WalletLedgerSource.CASHBACK,
          updateBalance: true,
          meta: { reason: 'welcome_bonus' },
        }).catch(() => {});
      }
    }

    // Generate tokens
    const tokens = await this.generateAuthTokens(user.id, user.phoneNo, user.role);

    // Notify other devices of a new sign-in (skip for brand-new accounts — no devices registered yet)
    if (!isNewUser) {
      NotificationService.sendToUser({
        userId: user.id,
        title:  'New Sign-In Detected',
        body:   'Your Serwise account was just signed in. If this wasn\'t you, contact support.',
        type:   NotificationType.SECURITY,
      }).catch(() => {});
    }

    return {
      user,
      tokens,
      isNewUser,
    };
  }

  static async generateAuthTokens(userId: string, phoneNo: string, role: Role) {
    const accessToken = jwt.sign(
      { id: userId, phoneNo, role },
      config.jwt.secret as jwt.Secret,
      { expiresIn: config.jwt.accessExpiry as any }
    );

    const refreshToken = jwt.sign(
      { id: userId },
      config.jwt.secret as jwt.Secret,
      { expiresIn: config.jwt.refreshExpiry as any }
    );

    // Save refresh token in DB
    const expiresAt = new Date();
    // Parse JWT expiry string (e.g. 60d) to Date
    const days = parseInt(config.jwt.refreshExpiry);
    expiresAt.setDate(expiresAt.getDate() + (isNaN(days) ? 60 : days));

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  static async refreshAccessToken(oldRefreshToken: string) {
    jwt.verify(oldRefreshToken, config.jwt.secret as jwt.Secret);

    const dbToken = await prisma.refreshToken.findUnique({
      where: { token: oldRefreshToken },
      include: { user: true }
    });

    if (!dbToken || dbToken.expiresAt < new Date()) {
      if (dbToken) await prisma.refreshToken.delete({ where: { id: dbToken.id } });
      throw new Error("Invalid or expired refresh token");
    }

    const user = dbToken.user;
    const accessToken = jwt.sign(
      { id: user.id, phoneNo: user.phoneNo, role: user.role },
      config.jwt.secret as jwt.Secret,
      { expiresIn: config.jwt.accessExpiry as any }
    );

    return { accessToken };
  }

  static async logout(refreshToken: string) {
    const record = await prisma.refreshToken.findUnique({
      where:  { token: refreshToken },
      select: { userId: true },
    });

    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });

    if (record?.userId) {
      NotificationService.sendToUser({
        userId: record.userId,
        title:  'Signed Out',
        body:   'Your Serwise account has been signed out.',
        type:   NotificationType.SECURITY,
      }).catch(() => {});
    }
  }

  // ── Provider (Radix) auth ─────────────────────────────────────────────────
  // Only allows existing PROVIDER accounts — never creates a user.

  static async providerRequestOtp(phoneNo: string) {
    const user = await prisma.user.findUnique({ where: { phoneNo } });

    if (!user || user.isDeleted || !user.isActive) {
      throw new ApiError(403, "This number is not registered as a professional");
    }

    if (user.role !== Role.PROVIDER) {
      throw new ApiError(403, "This number is not registered as a professional");
    }

    return this.generateOtp(phoneNo);
  }

  static async providerVerifyOtp(phoneNo: string, otp: string) {
    const record = await prisma.otp.findUnique({ where: { phoneNo } });

    if (!record) {
      throw new ApiError(400, "OTP not found or expired");
    }

    if (record.expiresAt < new Date()) {
      await prisma.otp.delete({ where: { phoneNo } });
      throw new ApiError(400, "OTP expired");
    }

    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      throw new ApiError(429, "Maximum OTP attempts exceeded");
    }

    const isMatch =
      (phoneNo in TEST_PHONES && otp === TEST_PHONES[phoneNo]) ||
      (await bcrypt.compare(otp, record.otp));

    if (!isMatch) {
      await prisma.otp.update({
        where: { phoneNo },
        data: { attempts: { increment: 1 } },
      });
      throw new ApiError(400, "Invalid OTP");
    }

    await prisma.otp.delete({ where: { phoneNo } });

    // No user creation — provider must already exist
    const user = await prisma.user.findUnique({ where: { phoneNo } });

    if (!user || user.isDeleted || !user.isActive || user.role !== Role.PROVIDER) {
      throw new ApiError(403, "Provider account not found");
    }

    const tokens = await this.generateAuthTokens(user.id, user.phoneNo, user.role);

    return { user, tokens };
  }
}
