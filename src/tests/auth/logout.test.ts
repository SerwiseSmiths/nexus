import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetAuthTables } from '../dbHelpers';
import prisma from '@/services/prisma.service';
import { DeviceApp, DevicePlatform, Role } from '@prisma/client';

// Only the outbound push is stubbed — logout also clears device tokens via
// the real NotificationService.clearDeviceTokens, which these tests assert on.
jest.mock('@/services/notification.service', () => {
  const actual = jest.requireActual('@/services/notification.service');
  actual.NotificationService.sendToUser = jest.fn().mockResolvedValue(undefined);
  return actual;
});

describe('POST /api/auth/logout', () => {
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

  it('deletes the refresh token so it can no longer be used', async () => {
    const user = await prisma.user.create({ data: { phoneNo: '9998887770', role: Role.CUSTOMER } });
    const token = 'a-refresh-token-value';
    await prisma.refreshToken.create({ data: { token, userId: user.id, expiresAt: new Date(Date.now() + 1000000) } });

    const res = await testRequest(app).post('/api/auth/logout').send({ refreshToken: token });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, statusCode: 200, message: 'Logged out successfully' });
    expect(await prisma.refreshToken.findUnique({ where: { token } })).toBeNull();
  });

  it("clears the user's device token for the app being logged out of, leaving other apps' tokens", async () => {
    const user = await prisma.user.create({ data: { phoneNo: '9998887771', role: Role.CUSTOMER } });
    const refreshToken = 'refresh-for-device-clear';
    await prisma.refreshToken.create({ data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 1000000) } });
    await prisma.deviceToken.createMany({
      data: [
        { userId: user.id, token: 'fcm-serwise', platform: DevicePlatform.ANDROID, app: DeviceApp.SERWISE },
        { userId: user.id, token: 'fcm-radix',   platform: DevicePlatform.ANDROID, app: DeviceApp.RADIX },
      ],
    });

    // testRequest sends x-app-id: serwise-app
    const res = await testRequest(app).post('/api/auth/logout').send({ refreshToken });

    expect(res.status).toBe(200);
    expect(await prisma.deviceToken.findUnique({ where: { token: 'fcm-serwise' } })).toBeNull();
    expect(await prisma.deviceToken.findUnique({ where: { token: 'fcm-radix' } })).not.toBeNull();
  });

  it('is idempotent: succeeds with 200 even when the refresh token does not exist', async () => {
    const res = await testRequest(app).post('/api/auth/logout').send({ refreshToken: 'never-existed' });
    expect(res.status).toBe(200);
  });

  it('is idempotent: succeeds with 200 even when no refresh token is provided at all', async () => {
    const res = await testRequest(app).post('/api/auth/logout').send({});
    expect(res.status).toBe(200);
  });
});
