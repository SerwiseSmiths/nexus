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
    emitComplaintCreated: jest.fn().mockResolvedValue(undefined),
    emitProviderAssigned: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('@/services/notification.service', () => ({
  NotificationService: { sendToUser: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('@/services/telegram.service', () => ({
  TelegramService: {
    notifyComplaintCreated: jest.fn().mockResolvedValue(undefined),
    notifyComplaintUpdated: jest.fn().mockResolvedValue(undefined),
    notifyNoProviderMatch: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('PATCH /api/complaint/:id/stage', () => {
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

  it('allows the assigned provider to make a legal transition', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const provider = await createUser(Role.PROVIDER);
    const address = await createAddressFor(customer.id);
    const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
    const token = signAccessToken(provider);

    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'QR_VALIDATED' });

    expect(res.status).toBe(200);
    expect(res.body.data.complaint.stage).toBe('QR_VALIDATED');
  });

  it('allows APPROVAL → IN_PROGRESS and IN_PROGRESS → PAYMENT (added 2026-09-12)', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const provider = await createUser(Role.PROVIDER);
    const address = await createAddressFor(customer.id);
    const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'APPROVAL' });
    const token = signAccessToken(provider);

    const toInProgress = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'IN_PROGRESS' });
    expect(toInProgress.status).toBe(200);
    expect(toInProgress.body.data.complaint.stage).toBe('IN_PROGRESS');

    const toPayment = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'PAYMENT' });
    expect(toPayment.status).toBe(200);
    expect(toPayment.body.data.complaint.stage).toBe('PAYMENT');
  });

  it('rejects APPROVAL → PAYMENT directly, skipping IN_PROGRESS (added 2026-09-12)', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const provider = await createUser(Role.PROVIDER);
    const address = await createAddressFor(customer.id);
    const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'APPROVAL' });
    const token = signAccessToken(provider);

    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'PAYMENT' });

    expect(res.status).toBe(400);
  });

  it('rejects a missing/invalid stage with a friendly 400 message (fixed 2026-09-12 — was a raw Zod message)', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const provider = await createUser(Role.PROVIDER);
    const address = await createAddressFor(customer.id);
    const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
    const token = signAccessToken(provider);

    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'NOT_A_REAL_STAGE' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('stage: Please select a valid stage');
  });

  it('rejects an illegal transition with 400 naming the allowed ones', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const provider = await createUser(Role.PROVIDER);
    const address = await createAddressFor(customer.id);
    const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
    const token = signAccessToken(provider);

    // ENTRANCE cannot jump straight to PAYMENT
    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'PAYMENT' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Cannot transition from ENTRANCE to PAYMENT/);
  });

  it('rejects APPROVAL → ESTIMATION as illegal (matches STAGE_TRANSITIONS, not the old doc claim)', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const provider = await createUser(Role.PROVIDER);
    const address = await createAddressFor(customer.id);
    const complaint = await createComplaintFor(customer.id, address.id, {
      providerId: provider.id,
      stage: 'APPROVAL',
    });
    const token = signAccessToken(provider);

    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'ESTIMATION' });

    expect(res.status).toBe(400);
  });

  it('rejects a PROVIDER who is not assigned to this complaint with 404 (fixed 2026-09-07 — previously no ownership check at all)', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const assignedProvider = await createUser(Role.PROVIDER);
    const unrelatedProvider = await createUser(Role.PROVIDER);
    const address = await createAddressFor(customer.id);
    const complaint = await createComplaintFor(customer.id, address.id, { providerId: assignedProvider.id });
    const token = signAccessToken(unrelatedProvider);

    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'QR_VALIDATED' });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Complaint not found or not assigned to you');

    const unchanged = await prisma.complaint.findUnique({ where: { id: complaint.id } });
    expect(unchanged?.stage).toBe('ENTRANCE');
  });

  it('allows ADMIN to transition any complaint regardless of assignment', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const provider = await createUser(Role.PROVIDER);
    const admin = await createUser(Role.ADMIN);
    const address = await createAddressFor(customer.id);
    const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
    const token = signAccessToken(admin);

    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'QR_VALIDATED' });

    expect(res.status).toBe(200);
  });

  it('records rejectionReason/rejectedAt/rejectedBy when transitioning to REJECTED', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const provider = await createUser(Role.PROVIDER);
    const address = await createAddressFor(customer.id);
    const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
    const token = signAccessToken(provider);

    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'REJECTED', rejectionReason: 'Customer not reachable' });

    expect(res.status).toBe(200);
    expect(res.body.data.complaint.rejectionReason).toBe('Customer not reachable');
    expect(res.body.data.complaint.rejectedBy).toBe(provider.id);
  });

  it('rejects a CUSTOMER caller with 403 (role gate — customers cannot directly change stage)', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const address = await createAddressFor(customer.id);
    const complaint = await createComplaintFor(customer.id, address.id);
    const token = signAccessToken(customer);

    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/stage`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'QR_VALIDATED' });

    expect(res.status).toBe(403);
  });

  it('returns 404 for a nonexistent complaint id', async () => {
    const provider = await createUser(Role.PROVIDER);
    const token = signAccessToken(provider);

    const res = await testRequest(app)
      .patch('/api/complaint/00000000-0000-0000-0000-000000000000/stage')
      .set('Authorization', `Bearer ${token}`)
      .send({ stage: 'QR_VALIDATED' });

    expect(res.status).toBe(404);
  });
});
