import { testRequest } from '../apiClient';
import jwt from 'jsonwebtoken';
import { getTestApp } from '../testApp';
import { resetAuthTables } from '../dbHelpers';
import prisma from '@/services/prisma.service';
import { config } from '@/configs';
import { Role } from '@prisma/client';

describe('POST /api/auth/refresh-token', () => {
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

  async function createUserWithRefreshToken(overrides: { expiresAt?: Date } = {}) {
    const user = await prisma.user.create({ data: { phoneNo: '9998887770', role: Role.CUSTOMER } });
    const token = jwt.sign({ id: user.id }, config.jwt.secret as jwt.Secret, { expiresIn: '60d' });
    await prisma.refreshToken.create({
      data: { token, userId: user.id, expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) },
    });
    return { user, token };
  }

  it('issues a new access token for a valid refresh token', async () => {
    const { token } = await createUserWithRefreshToken();

    const res = await testRequest(app).post('/api/auth/refresh-token').send({ refreshToken: token });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, statusCode: 200, message: 'Token refreshed successfully' });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
  });

  it('rejects a missing refreshToken with 400', async () => {
    const res = await testRequest(app).post('/api/auth/refresh-token').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Refresh token is required');
  });

  it('rejects a malformed (non-JWT) refresh token with 401, not 500', async () => {
    const res = await testRequest(app).post('/api/auth/refresh-token').send({ refreshToken: 'not-a-real-jwt' });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, statusCode: 401, message: 'Your session has expired. Please log in again' });
  });

  it('rejects a well-formed but expired JWT with 401, not 500', async () => {
    const user = await prisma.user.create({ data: { phoneNo: '9998887771', role: Role.CUSTOMER } });
    const expiredToken = jwt.sign({ id: user.id }, config.jwt.secret as jwt.Secret, { expiresIn: -10 });
    await prisma.refreshToken.create({
      data: { token: expiredToken, userId: user.id, expiresAt: new Date(Date.now() + 1000) },
    });

    const res = await testRequest(app).post('/api/auth/refresh-token').send({ refreshToken: expiredToken });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Your session has expired. Please log in again');
  });

  it('rejects a valid JWT signature with no matching DB row (e.g. already logged out) with 401', async () => {
    const user = await prisma.user.create({ data: { phoneNo: '9998887772', role: Role.CUSTOMER } });
    const token = jwt.sign({ id: user.id }, config.jwt.secret as jwt.Secret, { expiresIn: '60d' });
    // Never persisted to RefreshToken table

    const res = await testRequest(app).post('/api/auth/refresh-token').send({ refreshToken: token });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Your session has expired. Please log in again');
  });

  it('rejects a DB-expired refresh token (JWT still cryptographically valid) with 401, and deletes the stale row', async () => {
    const { token, user } = await createUserWithRefreshToken({ expiresAt: new Date(Date.now() - 1000) });

    const res = await testRequest(app).post('/api/auth/refresh-token').send({ refreshToken: token });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Your session has expired. Please log in again');

    const remaining = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(remaining).toHaveLength(0);
  });

  it('rejects a refresh token signed with a different secret with 401, not 500', async () => {
    const user = await prisma.user.create({ data: { phoneNo: '9998887773', role: Role.CUSTOMER } });
    const foreignToken = jwt.sign({ id: user.id }, 'a-completely-different-secret-value', { expiresIn: '60d' });

    const res = await testRequest(app).post('/api/auth/refresh-token').send({ refreshToken: foreignToken });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Your session has expired. Please log in again');
  });
});
