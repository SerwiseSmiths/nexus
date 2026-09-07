import { testRequest } from '../apiClient';
import jwt from 'jsonwebtoken';
import { getTestApp } from '../testApp';
import { resetAuthTables } from '../dbHelpers';
import prisma from '@/services/prisma.service';
import { config } from '@/configs';
import { Role } from '@prisma/client';

// GET /api/complaints/my is `auth` + `authorize([CUSTOMER])` gated — a real, low-side-effect
// route for exercising the middleware chain end-to-end.
const PROTECTED_ROUTE = '/api/complaint/my';

function signAccessToken(payload: { id: string; phoneNo: string; role: Role }, expiresIn: number | string) {
  return jwt.sign(payload, config.jwt.secret as jwt.Secret, { expiresIn: expiresIn as any });
}

describe('auth/authorize middleware', () => {
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

  it('rejects a request with no Authorization header: 401, ApiResponse-shaped', async () => {
    const res = await testRequest(app).get(PROTECTED_ROUTE);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, statusCode: 401, message: 'Please log in to continue' });
  });

  it('treats a header with no "Bearer <token>" space as no token at all: 401 "Please log in to continue"', async () => {
    // authHeader.split(" ")[1] is undefined when there's no space, so this
    // falls into the same branch as a missing header entirely.
    const res = await testRequest(app).get(PROTECTED_ROUTE).set('Authorization', 'garbage-not-a-bearer-token');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Please log in to continue');
  });

  it('rejects a syntactically-invalid token after a Bearer scheme: 401 "Your session has expired. Please log in again"', async () => {
    const res = await testRequest(app).get(PROTECTED_ROUTE).set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Your session has expired. Please log in again');
  });

  it('rejects an expired access token: 401, not 500', async () => {
    const user = await prisma.user.create({ data: { phoneNo: '9998887770', role: Role.CUSTOMER } });
    const token = signAccessToken({ id: user.id, phoneNo: user.phoneNo, role: user.role }, -10);

    const res = await testRequest(app).get(PROTECTED_ROUTE).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Your session has expired. Please log in again');
  });

  it('accepts a valid token and reaches the route', async () => {
    const user = await prisma.user.create({ data: { phoneNo: '9998887770', role: Role.CUSTOMER } });
    const token = signAccessToken({ id: user.id, phoneNo: user.phoneNo, role: user.role }, '30d');

    const res = await testRequest(app).get(PROTECTED_ROUTE).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.complaints).toEqual([]);
  });

  it('issues a rolling refresh (x-new-access-token header) when less than 50% of the token lifespan remains', async () => {
    const user = await prisma.user.create({ data: { phoneNo: '9998887770', role: Role.CUSTOMER } });
    // 30-day expiry, issued 20 days ago → 10 days (33%) remaining, under the 50% threshold
    const iat = Math.floor(Date.now() / 1000) - 20 * 24 * 60 * 60;
    const exp = iat + 30 * 24 * 60 * 60;
    const token = jwt.sign({ id: user.id, phoneNo: user.phoneNo, role: user.role, iat, exp }, config.jwt.secret as jwt.Secret);

    const res = await testRequest(app).get(PROTECTED_ROUTE).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['x-new-access-token']).toEqual(expect.any(String));
  });

  it('does not issue a rolling refresh when more than 50% of the token lifespan remains', async () => {
    const user = await prisma.user.create({ data: { phoneNo: '9998887770', role: Role.CUSTOMER } });
    const token = signAccessToken({ id: user.id, phoneNo: user.phoneNo, role: user.role }, '30d');

    const res = await testRequest(app).get(PROTECTED_ROUTE).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['x-new-access-token']).toBeUndefined();
  });

  it('rejects a wrong role with 403, ApiResponse-shaped, naming the permission issue', async () => {
    const provider = await prisma.user.create({ data: { phoneNo: '9998887771', role: Role.PROVIDER } });
    const token = signAccessToken({ id: provider.id, phoneNo: provider.phoneNo, role: provider.role }, '30d');

    const res = await testRequest(app).get(PROTECTED_ROUTE).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, statusCode: 403, message: "You don't have permission to perform this action" });
  });
});
