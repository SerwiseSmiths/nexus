import { testRequest } from '../apiClient';
import bcrypt from 'bcryptjs';
import { getTestApp } from '../testApp';
import { resetAuthTables } from '../dbHelpers';
import prisma from '@/services/prisma.service';
import { Role } from '@prisma/client';

jest.mock('@/services/hanuotp.service', () => ({
  sendOtpSms: jest.fn().mockResolvedValue({ success: true }),
}));

const PHONE = '9998887770';
const OTP = '654321';

async function seedOtp(phoneNo: string, otp: string, overrides: Partial<{ expiresAt: Date; attempts: number }> = {}) {
  const hashed = await bcrypt.hash(otp, 10);
  await prisma.otp.upsert({
    where: { phoneNo },
    update: { otp: hashed, expiresAt: overrides.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000), attempts: overrides.attempts ?? 0 },
    create: { phoneNo, otp: hashed, expiresAt: overrides.expiresAt ?? new Date(Date.now() + 10 * 60 * 1000), attempts: overrides.attempts ?? 0 },
  });
}

describe('Provider (Radix) auth', () => {
  let app: import('express').Express;

  beforeAll(async () => {
    app = await getTestApp();
  });

  beforeEach(async () => {
    await resetAuthTables();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /api/auth/provider/request-otp', () => {
    it('sends an OTP for an active, registered provider', async () => {
      await prisma.user.create({ data: { phoneNo: PHONE, role: Role.PROVIDER } });

      const res = await testRequest(app).post('/api/auth/provider/request-otp').send({ phoneNo: PHONE });
      expect(res.status).toBe(200);

      expect(await prisma.otp.findUnique({ where: { phoneNo: PHONE } })).not.toBeNull();
    });

    it('rejects with 403 when the phone is not registered at all', async () => {
      const res = await testRequest(app).post('/api/auth/provider/request-otp').send({ phoneNo: PHONE });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('This number is not registered as a professional');
    });

    it('rejects with 403 for a registered CUSTOMER (not a provider)', async () => {
      await prisma.user.create({ data: { phoneNo: PHONE, role: Role.CUSTOMER } });

      const res = await testRequest(app).post('/api/auth/provider/request-otp').send({ phoneNo: PHONE });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('This number is not registered as a professional');
    });

    it('rejects with 403 for a deactivated provider account', async () => {
      await prisma.user.create({ data: { phoneNo: PHONE, role: Role.PROVIDER, isActive: false } });

      const res = await testRequest(app).post('/api/auth/provider/request-otp').send({ phoneNo: PHONE });
      expect(res.status).toBe(403);
    });

    it('rejects with 403 for a soft-deleted provider account', async () => {
      await prisma.user.create({ data: { phoneNo: PHONE, role: Role.PROVIDER, isDeleted: true } });

      const res = await testRequest(app).post('/api/auth/provider/request-otp').send({ phoneNo: PHONE });
      expect(res.status).toBe(403);
    });

    it('rejects a missing phoneNo with 400', async () => {
      const res = await testRequest(app).post('/api/auth/provider/request-otp').send({});
      expect(res.status).toBe(400);
    });

    it('rejects a malformed phoneNo with a friendly 400 message', async () => {
      const res = await testRequest(app).post('/api/auth/provider/request-otp').send({ phoneNo: '123' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Please enter a valid 10-digit phone number');
    });
  });

  describe('POST /api/auth/provider/verify-otp', () => {
    it('logs in an existing active provider without creating a new account', async () => {
      const provider = await prisma.user.create({ data: { phoneNo: PHONE, role: Role.PROVIDER } });
      await seedOtp(PHONE, OTP);

      const res = await testRequest(app).post('/api/auth/provider/verify-otp').send({ phoneNo: PHONE, otp: OTP });

      expect(res.status).toBe(200);
      expect(res.body.data.user.id).toBe(provider.id);
      expect(res.body.data.isNewUser).toBeUndefined();
      expect(res.body.data.tokens.accessToken).toEqual(expect.any(String));

      expect(await prisma.user.count()).toBe(1);
    });

    it('never creates a user for an unregistered phone, even with a correct OTP', async () => {
      await seedOtp(PHONE, OTP);

      const res = await testRequest(app).post('/api/auth/provider/verify-otp').send({ phoneNo: PHONE, otp: OTP });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Provider account not found');
      expect(await prisma.user.count()).toBe(0);
    });

    it('rejects 403 for a correct OTP against a CUSTOMER-role account', async () => {
      await prisma.user.create({ data: { phoneNo: PHONE, role: Role.CUSTOMER } });
      await seedOtp(PHONE, OTP);

      const res = await testRequest(app).post('/api/auth/provider/verify-otp').send({ phoneNo: PHONE, otp: OTP });
      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Provider account not found');
    });

    it('returns 400 "OTP not found or expired" when no OTP was requested', async () => {
      await prisma.user.create({ data: { phoneNo: PHONE, role: Role.PROVIDER } });

      const res = await testRequest(app).post('/api/auth/provider/verify-otp').send({ phoneNo: PHONE, otp: OTP });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('OTP not found or expired');
    });

    it('returns 400 "Invalid OTP" for a wrong code', async () => {
      await prisma.user.create({ data: { phoneNo: PHONE, role: Role.PROVIDER } });
      await seedOtp(PHONE, OTP);

      const res = await testRequest(app).post('/api/auth/provider/verify-otp').send({ phoneNo: PHONE, otp: '000000' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid OTP');
    });

    it('rejects a malformed OTP with a friendly 400 message', async () => {
      await prisma.user.create({ data: { phoneNo: PHONE, role: Role.PROVIDER } });
      await seedOtp(PHONE, OTP);

      const res = await testRequest(app).post('/api/auth/provider/verify-otp').send({ phoneNo: PHONE, otp: '12' });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Please enter a valid 6-digit OTP');
    });

    it('returns 429 after max attempts exceeded', async () => {
      await prisma.user.create({ data: { phoneNo: PHONE, role: Role.PROVIDER } });
      await seedOtp(PHONE, OTP, { attempts: 5 });

      const res = await testRequest(app).post('/api/auth/provider/verify-otp').send({ phoneNo: PHONE, otp: OTP });
      expect(res.status).toBe(429);
    });
  });
});
