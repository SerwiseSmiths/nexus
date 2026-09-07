import prisma from '@/services/prisma.service';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetDeviceTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser, VALID_METADATA } from './fixtures';

describe('Device work history', () => {
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

  describe('POST /api/device/:id/work-history', () => {
    it('adds a manual work history entry', async () => {
      const user = await createUser();
      const token = signAccessToken(user);
      const device = await addDevice(token, 'fridge');

      const res = await testRequest(app)
        .post(`/api/device/${device.id}/work-history`)
        .set('Authorization', `Bearer ${token}`)
        .send({ event: 'INSPECTION', eventDate: '2025-06-01T00:00:00.000Z', notes: 'Annual checkup' });

      expect(res.status).toBe(201);
      expect(res.body.data.entry.event).toBe('INSPECTION');
      expect(res.body.data.entry.notes).toBe('Annual checkup');
    });

    it('rejects a missing event with 400', async () => {
      const user = await createUser();
      const token = signAccessToken(user);
      const device = await addDevice(token, 'fridge');

      const res = await testRequest(app)
        .post(`/api/device/${device.id}/work-history`)
        .set('Authorization', `Bearer ${token}`)
        .send({ eventDate: '2025-06-01T00:00:00.000Z' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('event is required');
    });

    it('rejects a missing eventDate with 400', async () => {
      const user = await createUser();
      const token = signAccessToken(user);
      const device = await addDevice(token, 'fridge');

      const res = await testRequest(app)
        .post(`/api/device/${device.id}/work-history`)
        .set('Authorization', `Bearer ${token}`)
        .send({ event: 'INSPECTION' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('eventDate is required');
    });

    it('rejects an invalid event type with 400', async () => {
      const user = await createUser();
      const token = signAccessToken(user);
      const device = await addDevice(token, 'fridge');

      const res = await testRequest(app)
        .post(`/api/device/${device.id}/work-history`)
        .set('Authorization', `Bearer ${token}`)
        .send({ event: 'EXPLODED', eventDate: '2025-06-01T00:00:00.000Z' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Invalid event/);
    });

    it('rejects an unparseable eventDate with 400', async () => {
      const user = await createUser();
      const token = signAccessToken(user);
      const device = await addDevice(token, 'fridge');

      const res = await testRequest(app)
        .post(`/api/device/${device.id}/work-history`)
        .set('Authorization', `Bearer ${token}`)
        .send({ event: 'INSPECTION', eventDate: 'not-a-date' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Invalid eventDate/);
    });

    it('returns 404 for a device owned by another user', async () => {
      const owner = await createUser();
      const other = await createUser();
      const ownerToken = signAccessToken(owner);
      const otherToken = signAccessToken(other);
      const device = await addDevice(ownerToken, 'fridge');

      const res = await testRequest(app)
        .post(`/api/device/${device.id}/work-history`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ event: 'INSPECTION', eventDate: '2025-06-01T00:00:00.000Z' });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/device/:id/work-history', () => {
    it('lists history newest-first, including auto-recorded entries', async () => {
      const user = await createUser();
      const token = signAccessToken(user);
      const device = await addDevice(token, 'fridge');

      await testRequest(app)
        .post(`/api/device/${device.id}/work-history`)
        .set('Authorization', `Bearer ${token}`)
        .send({ event: 'INSPECTION', eventDate: '2030-01-01T00:00:00.000Z' });

      const res = await testRequest(app)
        .get(`/api/device/${device.id}/work-history`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.history.length).toBeGreaterThanOrEqual(3); // PURCHASED + INSTALLED + INSPECTION
      expect(res.body.data.history[0].event).toBe('INSPECTION'); // furthest-future eventDate, desc order
    });

    it('returns 404 for a device owned by another user', async () => {
      const owner = await createUser();
      const other = await createUser();
      const ownerToken = signAccessToken(owner);
      const otherToken = signAccessToken(other);
      const device = await addDevice(ownerToken, 'fridge');

      const res = await testRequest(app)
        .get(`/api/device/${device.id}/work-history`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/device/:id/work-history/:entryId', () => {
    it('soft-deletes an entry and excludes it from subsequent listings', async () => {
      const user = await createUser();
      const token = signAccessToken(user);
      const device = await addDevice(token, 'fridge');

      const addRes = await testRequest(app)
        .post(`/api/device/${device.id}/work-history`)
        .set('Authorization', `Bearer ${token}`)
        .send({ event: 'INSPECTION', eventDate: '2025-06-01T00:00:00.000Z' });
      const entryId = addRes.body.data.entry.id;

      const delRes = await testRequest(app)
        .delete(`/api/device/${device.id}/work-history/${entryId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(delRes.status).toBe(200);

      const listRes = await testRequest(app)
        .get(`/api/device/${device.id}/work-history`)
        .set('Authorization', `Bearer ${token}`);
      expect(listRes.body.data.history.find((h: { id: string }) => h.id === entryId)).toBeUndefined();
    });

    it('returns 404 for a non-existent entry id', async () => {
      const user = await createUser();
      const token = signAccessToken(user);
      const device = await addDevice(token, 'fridge');

      const res = await testRequest(app)
        .delete(`/api/device/${device.id}/work-history/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Work history entry not found');
    });

    it('returns 404 when the device belongs to another user', async () => {
      const owner = await createUser();
      const other = await createUser();
      const ownerToken = signAccessToken(owner);
      const otherToken = signAccessToken(other);
      const device = await addDevice(ownerToken, 'fridge');

      const addRes = await testRequest(app)
        .post(`/api/device/${device.id}/work-history`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ event: 'INSPECTION', eventDate: '2025-06-01T00:00:00.000Z' });
      const entryId = addRes.body.data.entry.id;

      const res = await testRequest(app)
        .delete(`/api/device/${device.id}/work-history/${entryId}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(res.status).toBe(404);

      const entry = await prisma.deviceWorkHistory.findUnique({ where: { id: entryId } });
      expect(entry?.isDeleted).toBe(false);
    });
  });
});
