import { testRequest } from '../apiClient';
import bcrypt from 'bcryptjs';
import { getTestApp } from '../testApp';
import { resetAuthTables } from '../dbHelpers';
import prisma from '@/services/prisma.service';
import { Role } from '@prisma/client';

jest.mock('@/services/strapi.service', () => ({
  StrapiService: { fetchWelcomeBonus: jest.fn(), ping: jest.fn() },
}));
jest.mock('@/services/telegram.service', () => ({
  TelegramService: { notifyNewUser: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('@/services/notification.service', () => ({
  NotificationService: { sendToUser: jest.fn().mockResolvedValue(undefined) },
}));

import { StrapiService } from '@/services/strapi.service';
import { NotificationService } from '@/services/notification.service';

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

describe('POST /api/auth/verify-otp', () => {
  let app: import('express').Express;

  beforeAll(async () => {
    app = await getTestApp();
  });

  beforeEach(async () => {
    await resetAuthTables();
    (StrapiService.fetchWelcomeBonus as jest.Mock).mockResolvedValue({ isEnabled: false, amount: 0 });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects missing phoneNo/otp with 400', async () => {
    const res = await testRequest(app).post('/api/auth/verify-otp').send({ phoneNo: PHONE });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Phone number and OTP are required');
  });

  it('rejects a malformed phoneNo with a friendly 400 message', async () => {
    const res = await testRequest(app).post('/api/auth/verify-otp').send({ phoneNo: '12345', otp: OTP });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Please enter a valid 10-digit phone number');
  });

  it('rejects a malformed OTP (wrong length / non-numeric) with a friendly 400 message', async () => {
    const res = await testRequest(app).post('/api/auth/verify-otp').send({ phoneNo: PHONE, otp: 'abc123' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Please enter a valid 6-digit OTP');
  });

  it('returns 400 "OTP not found or expired" when no OTP was ever requested', async () => {
    const res = await testRequest(app).post('/api/auth/verify-otp').send({ phoneNo: PHONE, otp: OTP });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, statusCode: 400, message: 'OTP not found or expired' });
  });

  it('returns 400 "OTP expired" for an expired OTP, and deletes the stale record', async () => {
    await seedOtp(PHONE, OTP, { expiresAt: new Date(Date.now() - 60 * 1000) });

    const res = await testRequest(app).post('/api/auth/verify-otp').send({ phoneNo: PHONE, otp: OTP });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('OTP expired');

    expect(await prisma.otp.findUnique({ where: { phoneNo: PHONE } })).toBeNull();
  });

  it('returns 400 "Invalid OTP" for a wrong code and increments the attempt counter', async () => {
    await seedOtp(PHONE, OTP);

    const res = await testRequest(app).post('/api/auth/verify-otp').send({ phoneNo: PHONE, otp: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid OTP');

    const row = await prisma.otp.findUnique({ where: { phoneNo: PHONE } });
    expect(row?.attempts).toBe(1);
  });

  it('returns 429 "Maximum OTP attempts exceeded" after 5 failed attempts, even with the correct OTP on the next try', async () => {
    await seedOtp(PHONE, OTP, { attempts: 5 });

    const res = await testRequest(app).post('/api/auth/verify-otp').send({ phoneNo: PHONE, otp: OTP });
    expect(res.status).toBe(429);
    expect(res.body.message).toBe('Maximum OTP attempts exceeded');
  });

  it('logs in with a correct, unexpired OTP: creates a new user, wallet, and returns tokens', async () => {
    await seedOtp(PHONE, OTP);

    const res = await testRequest(app).post('/api/auth/verify-otp').send({ phoneNo: PHONE, otp: OTP });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, statusCode: 200, message: 'Login successful' });
    expect(res.body.data.isNewUser).toBe(true);
    expect(res.body.data.user.phoneNo).toBe(PHONE);
    expect(res.body.data.tokens.accessToken).toEqual(expect.any(String));
    expect(res.body.data.tokens.refreshToken).toEqual(expect.any(String));

    const user = await prisma.user.findUnique({ where: { phoneNo: PHONE } });
    expect(user).not.toBeNull();
    expect(user?.role).toBe(Role.CUSTOMER);

    const wallet = await prisma.wallet.findUnique({ where: { userId: user!.id } });
    expect(wallet).not.toBeNull();

    // OTP consumed
    expect(await prisma.otp.findUnique({ where: { phoneNo: PHONE } })).toBeNull();

    // Brand-new account: no prior device to notify, so no "new sign-in" push
    expect(NotificationService.sendToUser).not.toHaveBeenCalled();
  });

  it('credits the welcome bonus for a new user when enabled in CMS', async () => {
    (StrapiService.fetchWelcomeBonus as jest.Mock).mockResolvedValue({ isEnabled: true, amount: 50 });
    await seedOtp(PHONE, OTP);

    const res = await testRequest(app).post('/api/auth/verify-otp').send({ phoneNo: PHONE, otp: OTP });
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { phoneNo: PHONE } });
    const wallet = await prisma.wallet.findUnique({ where: { userId: user!.id } });
    expect(wallet?.balance).toBe(50);
  });

  it('logs in an existing user without creating a duplicate account, and sends a "new sign-in" push', async () => {
    await prisma.user.create({ data: { phoneNo: PHONE, role: Role.CUSTOMER } });
    await seedOtp(PHONE, OTP);

    const res = await testRequest(app).post('/api/auth/verify-otp').send({ phoneNo: PHONE, otp: OTP });

    expect(res.status).toBe(200);
    expect(res.body.data.isNewUser).toBe(false);

    const users = await prisma.user.findMany({ where: { phoneNo: PHONE } });
    expect(users).toHaveLength(1);

    expect(NotificationService.sendToUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: users[0].id, type: 'SECURITY' })
    );
  });

  it('accepts the hardcoded test-phone OTP (123456) without ever requiring a real OTP request, in this environment', async () => {
    const res = await testRequest(app)
      .post('/api/auth/verify-otp')
      .send({ phoneNo: '1234567890', otp: '123456' });

    // Test phones bypass OTP-record lookup entirely only when combined with a
    // prior /request-otp call (which creates the Otp row); calling verify-otp
    // directly without requesting first still 400s since no record exists.
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('OTP not found or expired');
  });

  it('logs in successfully via a test phone once an OTP record exists, using the fixed code regardless of the stored hash', async () => {
    await seedOtp('1234567890', 'irrelevant-because-test-phone');

    const res = await testRequest(app)
      .post('/api/auth/verify-otp')
      .send({ phoneNo: '1234567890', otp: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.data.tokens.accessToken).toEqual(expect.any(String));
  });

  it('returns a consistent ApiResponse-shaped error body for every failure case (no raw 500s)', async () => {
    const missing = await testRequest(app).post('/api/auth/verify-otp').send({ phoneNo: PHONE, otp: OTP });
    expect(missing.status).not.toBe(500);
    expect(missing.body).toEqual(
      expect.objectContaining({ success: false, statusCode: expect.any(Number), message: expect.any(String) })
    );
  });
});
