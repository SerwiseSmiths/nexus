import prisma from '@/services/prisma.service';
import { Role } from '@prisma/client';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetComplaintTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser, createAddressFor, createComplaintFor, createProviderWithSkills } from './fixtures';

jest.mock('@/services/realtime.service', () => ({
  RealtimeService: {
    emitProviderAssigned: jest.fn().mockResolvedValue(undefined),
    emitProviderAccepted: jest.fn().mockResolvedValue(undefined),
    emitProviderRejected: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('@/services/notification.service', () => ({
  NotificationService: { sendToUser: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('@/services/telegram.service', () => ({
  TelegramService: {
    notifyNoProviderMatch: jest.fn().mockResolvedValue(undefined),
    notifyComplaintCreated: jest.fn().mockResolvedValue(undefined),
    notifyComplaintUpdated: jest.fn().mockResolvedValue(undefined),
  },
}));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Provider assignment', () => {
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

  describe('PATCH /api/complaint/:id/assign (ADMIN)', () => {
    it('assigns a provider and resets acceptance state', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const admin = await createUser(Role.ADMIN);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id);
      const token = signAccessToken(admin);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({ providerId: provider.id });

      expect(res.status).toBe(200);
      expect(res.body.data.complaint.providerId).toBe(provider.id);
      expect(res.body.data.complaint.providerAccepted).toBe(false);
    });

    it('rejects assigning to a closed complaint with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const admin = await createUser(Role.ADMIN);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { stage: 'COMPLETED' });
      const token = signAccessToken(admin);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({ providerId: provider.id });

      expect(res.status).toBe(400);
    });

    it('rejects a non-ADMIN caller with 403', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id);
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/assign`)
        .set('Authorization', `Bearer ${token}`)
        .send({ providerId: provider.id });

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/complaint/:id/accept', () => {
    it('accepts an assignment', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/accept`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.complaint.providerAccepted).toBe(true);
    });

    it('rejects double-accept with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
      const token = signAccessToken(provider);

      await testRequest(app).patch(`/api/complaint/${complaint.id}/accept`).set('Authorization', `Bearer ${token}`);
      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/accept`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Assignment already accepted');
    });

    it('rejects a provider who is not assigned with 404', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const assignedProvider = await createUser(Role.PROVIDER);
      const unrelatedProvider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: assignedProvider.id });
      const token = signAccessToken(unrelatedProvider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/accept`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/complaint/:id/reject-assignment', () => {
    it('clears providerId and records the rejection', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/reject-assignment`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.complaint.rejectedProviderIds).toContain(provider.id);
    });

    it('re-triggers auto-assignment to a different eligible provider (fixed 2026-09-07 — previously the complaint stalled unassigned forever)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const rejectingProvider = await createProviderWithSkills(['fridge']);
      const nextProvider = await createProviderWithSkills(['fridge']);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: rejectingProvider.id });
      const token = signAccessToken(rejectingProvider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/reject-assignment`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.complaint.providerId).toBeNull();

      // autoAssignProvider runs fire-and-forget — give it a moment to complete.
      await wait(300);

      const reassigned = await prisma.complaint.findUnique({ where: { id: complaint.id } });
      expect(reassigned?.providerId).toBe(nextProvider.id);
    });

    it('leaves the complaint unassigned (not erroring) when no other eligible provider exists', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const onlyProvider = await createProviderWithSkills(['fridge']);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: onlyProvider.id });
      const token = signAccessToken(onlyProvider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/reject-assignment`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);

      await wait(300);

      const stillUnassigned = await prisma.complaint.findUnique({ where: { id: complaint.id } });
      expect(stillUnassigned?.providerId).toBeNull();
    });
  });
});
