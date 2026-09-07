import prisma from '@/services/prisma.service';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetDeviceTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser, VALID_METADATA } from './fixtures';

describe('GET /api/device and /api/device/:id', () => {
  let app: import('express').Express;

  beforeAll(async () => {
    app = await getTestApp();
  });

  beforeEach(async () => {
    await resetDeviceTables();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function addDevice(token: string, deviceKey = 'fridge') {
    const res = await testRequest(app)
      .post('/api/device')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceKey, metadata: VALID_METADATA[deviceKey] });
    return res.body.data.device;
  }

  it('only lists devices belonging to the authenticated user', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const tokenA = signAccessToken(userA);
    const tokenB = signAccessToken(userB);

    await addDevice(tokenA, 'fridge');
    await addDevice(tokenB, 'geyser');

    const res = await testRequest(app).get('/api/device').set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.devices).toHaveLength(1);
    expect(res.body.data.devices[0].deviceKey).toBe('fridge');
  });

  it('filters by deviceKey', async () => {
    const user = await createUser();
    const token = signAccessToken(user);
    await addDevice(token, 'fridge');
    await addDevice(token, 'geyser');

    const res = await testRequest(app)
      .get('/api/device')
      .query({ deviceKey: 'geyser' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.devices).toHaveLength(1);
    expect(res.body.data.devices[0].deviceKey).toBe('geyser');
  });

  it('fetches a single device with its work history', async () => {
    const user = await createUser();
    const token = signAccessToken(user);
    const device = await addDevice(token, 'fridge');

    const res = await testRequest(app).get(`/api/device/${device.id}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.device.id).toBe(device.id);
    expect(res.body.data.device.workHistory).toEqual(expect.any(Array));
    expect(res.body.data.device.workHistory.length).toBeGreaterThan(0);
  });

  it('returns 404 for a device owned by another user', async () => {
    const owner = await createUser();
    const other = await createUser();
    const ownerToken = signAccessToken(owner);
    const otherToken = signAccessToken(other);
    const device = await addDevice(ownerToken, 'fridge');

    const res = await testRequest(app).get(`/api/device/${device.id}`).set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Device not found');
  });

  it('returns 404 for a non-existent device id', async () => {
    const user = await createUser();
    const token = signAccessToken(user);

    const res = await testRequest(app)
      .get('/api/device/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for a soft-deleted device and excludes it from the list', async () => {
    const user = await createUser();
    const token = signAccessToken(user);
    const device = await addDevice(token, 'fridge');

    await testRequest(app).delete(`/api/device/${device.id}`).set('Authorization', `Bearer ${token}`);

    const getRes = await testRequest(app).get(`/api/device/${device.id}`).set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(404);

    const listRes = await testRequest(app).get('/api/device').set('Authorization', `Bearer ${token}`);
    expect(listRes.body.data.devices).toHaveLength(0);
  });

  it('rejects with 401 when no token is provided', async () => {
    const res = await testRequest(app).get('/api/device');
    expect(res.status).toBe(401);
  });
});
