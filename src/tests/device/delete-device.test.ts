import prisma from '@/services/prisma.service';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetDeviceTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser, VALID_METADATA } from './fixtures';

describe('DELETE /api/device/:id', () => {
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

  it('soft-deletes a device (isDeleted:true, row still exists)', async () => {
    const user = await createUser();
    const token = signAccessToken(user);
    const device = await addDevice(token, 'fridge');

    const res = await testRequest(app).delete(`/api/device/${device.id}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Device deleted successfully');

    const row = await prisma.device.findUnique({ where: { id: device.id } });
    expect(row).not.toBeNull();
    expect(row?.isDeleted).toBe(true);
  });

  it('returns 404 on a second delete of the same device (already gone)', async () => {
    const user = await createUser();
    const token = signAccessToken(user);
    const device = await addDevice(token, 'fridge');

    await testRequest(app).delete(`/api/device/${device.id}`).set('Authorization', `Bearer ${token}`);
    const res = await testRequest(app).delete(`/api/device/${device.id}`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 when deleting a device owned by another user, and does not delete it', async () => {
    const owner = await createUser();
    const other = await createUser();
    const ownerToken = signAccessToken(owner);
    const otherToken = signAccessToken(other);
    const device = await addDevice(ownerToken, 'fridge');

    const res = await testRequest(app).delete(`/api/device/${device.id}`).set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(404);

    const row = await prisma.device.findUnique({ where: { id: device.id } });
    expect(row?.isDeleted).toBe(false);
  });
});
