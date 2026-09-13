import prisma from '@/services/prisma.service';
import { Role } from '@prisma/client';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetComplaintTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser, createAddressFor, createComplaintFor } from './fixtures';

jest.mock('@/services/realtime.service', () => ({
  RealtimeService: {
    emitStageChanged: jest.fn().mockResolvedValue(undefined),
    emitQrScanRequested: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('@/services/notification.service', () => ({
  NotificationService: { sendToUser: jest.fn().mockResolvedValue(undefined) },
}));

describe('Entry QR flow', () => {
  let app: import('express').Express;

  beforeAll(async () => {
    app = await getTestApp();
  });

  beforeEach(async () => {
    await resetComplaintTables();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /api/complaint/:id/qr/generate', () => {
    it('the owning customer generates a token with a 10-minute expiry', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id);
      const token = signAccessToken(customer);

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/qr/generate`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.token).toEqual(expect.any(String));
      const expiresAt = new Date(res.body.data.expiresAt).getTime();
      expect(expiresAt - Date.now()).toBeGreaterThan(9 * 60 * 1000);
      expect(expiresAt - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000 + 2000);
    });

    it('rejects a non-owning customer with 404', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const other = await createUser(Role.CUSTOMER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id);
      const token = signAccessToken(other);

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/qr/generate`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('rejects generating outside ENTRANCE/QR_VALIDATED with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { stage: 'ESTIMATION' });
      const token = signAccessToken(customer);

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/qr/generate`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/complaint/:id/qr/validate', () => {
    it('the assigned provider validates a correct token and stage advances to QR_VALIDATED', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
      const customerToken = signAccessToken(customer);
      const providerToken = signAccessToken(provider);

      const genRes = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/qr/generate`)
        .set('Authorization', `Bearer ${customerToken}`);
      const { token: qrToken } = genRes.body.data;

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/qr/validate`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ token: qrToken });

      expect(res.status).toBe(200);
      expect(res.body.data.complaint.stage).toBe('QR_VALIDATED');

      const stored = await prisma.complaint.findUnique({ where: { id: complaint.id } });
      expect(stored?.entryQrToken).toBeNull();
    });

    it('rejects a wrong token with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
      const customerToken = signAccessToken(customer);
      const providerToken = signAccessToken(provider);

      await testRequest(app).post(`/api/complaint/${complaint.id}/qr/generate`).set('Authorization', `Bearer ${customerToken}`);

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/qr/validate`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ token: 'wrong-token' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid QR token');
    });

    it('rejects an expired token with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
      const providerToken = signAccessToken(provider);

      await prisma.complaint.update({
        where: { id: complaint.id },
        data: { entryQrToken: 'expired-token', entryQrExpiresAt: new Date(Date.now() - 1000) },
      });

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/qr/validate`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ token: 'expired-token' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/expired/);
    });

    it('rejects validation when stage is already past ENTRANCE with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'QR_VALIDATED' });
      const providerToken = signAccessToken(provider);

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/qr/validate`)
        .set('Authorization', `Bearer ${providerToken}`)
        .send({ token: 'irrelevant' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('QR already validated');
    });

    it('rejects a provider not assigned to the complaint with 404', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const assignedProvider = await createUser(Role.PROVIDER);
      const unrelatedProvider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: assignedProvider.id });
      const token = signAccessToken(unrelatedProvider);

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/qr/validate`)
        .set('Authorization', `Bearer ${token}`)
        .send({ token: 'x' });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/complaint/:id/qr/request-scan', () => {
    it('generates a fresh token when none exists yet', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/qr/request-scan`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);

      const stored = await prisma.complaint.findUnique({ where: { id: complaint.id } });
      expect(stored?.entryQrToken).toEqual(expect.any(String));
    });

    it('rejects outside ENTRANCE stage with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'ESTIMATION' });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/qr/request-scan`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });
});
