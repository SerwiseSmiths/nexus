import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetAuthTables } from '../dbHelpers';
import prisma from '@/services/prisma.service';
import { Role } from '@prisma/client';

jest.mock('@/services/notification.service', () => ({
  NotificationService: { sendToUser: jest.fn().mockResolvedValue(undefined) },
}));

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

  it('is idempotent: succeeds with 200 even when the refresh token does not exist', async () => {
    const res = await testRequest(app).post('/api/auth/logout').send({ refreshToken: 'never-existed' });
    expect(res.status).toBe(200);
  });

  it('is idempotent: succeeds with 200 even when no refresh token is provided at all', async () => {
    const res = await testRequest(app).post('/api/auth/logout').send({});
    expect(res.status).toBe(200);
  });
});
