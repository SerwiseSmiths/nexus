import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { signAccessToken } from '../authHelpers';
import { resetAuthTables } from '../dbHelpers';
import prisma from '@/services/prisma.service';
import { DeviceApp, DevicePlatform, Role } from '@prisma/client';

describe('POST /api/notification/device/register', () => {
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

  const register = (user: { id: string; phoneNo: string; role: Role }, token: string) =>
    testRequest(app)
      .post('/api/notification/device/register')
      .set('Authorization', `Bearer ${signAccessToken(user)}`)
      .send({ token, platform: 'ANDROID' });

  it('keeps only one token per user: a new token replaces the previous one', async () => {
    const user = await prisma.user.create({ data: { phoneNo: '9998887772', role: Role.CUSTOMER } });

    expect((await register(user, 'fcm-old')).status).toBe(200);
    expect((await register(user, 'fcm-new')).status).toBe(200);

    const tokens = await prisma.deviceToken.findMany({ where: { userId: user.id } });
    expect(tokens.map(t => t.token)).toEqual(['fcm-new']);
  });

  it('re-registering the same token is a no-op (still exactly one row)', async () => {
    const user = await prisma.user.create({ data: { phoneNo: '9998887773', role: Role.CUSTOMER } });

    await register(user, 'fcm-same');
    await register(user, 'fcm-same');

    expect(await prisma.deviceToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it("does not touch the same user's token for the other app", async () => {
    const user = await prisma.user.create({ data: { phoneNo: '9998887774', role: Role.CUSTOMER } });
    await prisma.deviceToken.create({
      data: { userId: user.id, token: 'fcm-radix', platform: DevicePlatform.ANDROID, app: DeviceApp.RADIX },
    });

    // testRequest sends x-app-id: serwise-app
    await register(user, 'fcm-serwise');

    const tokens = await prisma.deviceToken.findMany({ where: { userId: user.id }, orderBy: { token: 'asc' } });
    expect(tokens.map(t => t.token)).toEqual(['fcm-radix', 'fcm-serwise']);
  });

  it('moves a token to the new user when a different account signs in on the same device', async () => {
    const first  = await prisma.user.create({ data: { phoneNo: '9998887775', role: Role.CUSTOMER } });
    const second = await prisma.user.create({ data: { phoneNo: '9998887776', role: Role.CUSTOMER } });

    await register(first, 'fcm-shared-device');
    await register(second, 'fcm-shared-device');

    const row = await prisma.deviceToken.findUnique({ where: { token: 'fcm-shared-device' } });
    expect(row).toMatchObject({ userId: second.id, isActive: true });
    expect(await prisma.deviceToken.count({ where: { userId: first.id } })).toBe(0);
  });
});
