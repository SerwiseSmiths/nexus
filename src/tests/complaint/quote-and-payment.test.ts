import prisma from '@/services/prisma.service';
import { Role } from '@prisma/client';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetComplaintTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser, createAddressFor, createComplaintFor } from './fixtures';

jest.mock('@/services/realtime.service', () => ({
  RealtimeService: {
    emitQuoteAdded: jest.fn().mockResolvedValue(undefined),
    emitQuoteResponded: jest.fn().mockResolvedValue(undefined),
    emitStageChanged: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('@/services/notification.service', () => ({
  NotificationService: { sendToUser: jest.fn().mockResolvedValue(undefined) },
}));

describe('Quote flow', () => {
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

  describe('POST /api/complaint/:id/quote', () => {
    it('the assigned provider submits a quote and stage moves to APPROVAL', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'ESTIMATION' });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/quote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ name: 'Compressor replacement', unitPrice: 1500, quantity: 1 }] });

      expect(res.status).toBe(201);
      expect(res.body.data.quote.totalAmount).toBe(1500);
      expect(res.body.data.complaint.stage).toBe('APPROVAL');
    });

    it('rejects submitting a quote before QR validation with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/quote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ name: 'x', unitPrice: 100, quantity: 1 }] });

      expect(res.status).toBe(400);
    });

    it('rejects an empty items array with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'ESTIMATION' });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/quote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [] });

      expect(res.status).toBe(400);
    });

    it('rejects a provider not assigned to the complaint with 404', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const assignedProvider = await createUser(Role.PROVIDER);
      const unrelatedProvider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: assignedProvider.id, stage: 'ESTIMATION' });
      const token = signAccessToken(unrelatedProvider);

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/quote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ name: 'x', unitPrice: 100, quantity: 1 }] });

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/complaint/:id/quote/respond', () => {
    it('customer approves a non-zero quote → stage IN_PROGRESS (repair starts, not payment yet)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'APPROVAL', totalAmount: 800,
      });
      const token = signAccessToken(customer);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/quote/respond`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approved: true });

      expect(res.status).toBe(200);
      expect(res.body.data.complaint.stage).toBe('IN_PROGRESS');
    });

    it('customer approves a zero-amount quote → stage COMPLETED directly (skips payment)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'APPROVAL', totalAmount: 0,
      });
      const token = signAccessToken(customer);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/quote/respond`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approved: true });

      expect(res.status).toBe(200);
      expect(res.body.data.complaint.stage).toBe('COMPLETED');
    });

    it('customer rejects a quote → stage REJECTED, quote marked REJECTED', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'APPROVAL', totalAmount: 500,
      });
      const token = signAccessToken(customer);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/quote/respond`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approved: false, rejectionReason: 'Too expensive' });

      expect(res.status).toBe(200);
      expect(res.body.data.complaint.stage).toBe('REJECTED');
      expect(res.body.data.complaint.rejectionReason).toBe('Too expensive');

      const quote = await prisma.quote.findUnique({ where: { complaintId: complaint.id } });
      expect(quote?.status).toBe('REJECTED');
    });

    it('rejects responding when not in APPROVAL stage with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'ESTIMATION', totalAmount: 500,
      });
      const token = signAccessToken(customer);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/quote/respond`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approved: true });

      expect(res.status).toBe(400);
    });

    it('rejects a missing "approved" field with a friendly 400 message (fixed 2026-09-12 — was a raw Zod message)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'APPROVAL', totalAmount: 500,
      });
      const token = signAccessToken(customer);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/quote/respond`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('approved: Please specify whether the quote is approved');
    });

    it('rejects a different customer responding to this complaint\'s quote with 404', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const otherCustomer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'APPROVAL', totalAmount: 500,
      });
      const token = signAccessToken(otherCustomer);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/quote/respond`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approved: true });

      expect(res.status).toBe(404);
    });

    it('allows ADMIN to respond on behalf of the customer', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const admin = await createUser(Role.ADMIN);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'APPROVAL', totalAmount: 500,
      });
      const token = signAccessToken(admin);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/quote/respond`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approved: true });

      expect(res.status).toBe(200);
    });
  });

  describe('PATCH /api/complaint/:id/complete-service (new — added with the IN_PROGRESS stage)', () => {
    it('the assigned provider marks the repair done and moves the complaint to PAYMENT', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'IN_PROGRESS', totalAmount: 500,
      });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/complete-service`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.complaint.stage).toBe('PAYMENT');
    });

    it('rejects completion outside IN_PROGRESS with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'APPROVAL' });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/complete-service`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Complaint is not in progress');
    });

    it('rejects a provider not assigned to the complaint with 404', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const assignedProvider = await createUser(Role.PROVIDER);
      const unrelatedProvider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: assignedProvider.id, stage: 'IN_PROGRESS', totalAmount: 500,
      });
      const token = signAccessToken(unrelatedProvider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/complete-service`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('rejects a CUSTOMER caller with 403 (role gate)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'IN_PROGRESS', totalAmount: 500,
      });
      const token = signAccessToken(customer);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/complete-service`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/complaint/:id/complete-payment', () => {
    it('rejects a missing/invalid method with a friendly 400 message (fixed 2026-09-12 — was a raw Zod message)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'PAYMENT', totalAmount: 300,
      });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/complete-payment`)
        .set('Authorization', `Bearer ${token}`)
        .send({ method: 'BITCOIN' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('method: Please choose a payment method: CASH or WALLET');
    });

    it('CASH: completes without touching the customer wallet', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'PAYMENT', totalAmount: 300,
      });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/complete-payment`)
        .set('Authorization', `Bearer ${token}`)
        .send({ method: 'CASH' });

      expect(res.status).toBe(200);
      expect(res.body.data.complaint.stage).toBe('COMPLETED');

      const providerWallet = await prisma.wallet.findUnique({ where: { userId: provider.id } });
      expect(providerWallet?.balance).toBe(300);
    });

    it('WALLET: debits the customer and credits the provider when balance is sufficient (fixed 2026-09-07)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'PAYMENT', totalAmount: 300,
      });
      await prisma.wallet.create({ data: { userId: customer.id, walletType: 'CUSTOMER', balance: 1000 } });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/complete-payment`)
        .set('Authorization', `Bearer ${token}`)
        .send({ method: 'WALLET' });

      expect(res.status).toBe(200);
      expect(res.body.data.complaint.stage).toBe('COMPLETED');

      const customerWallet = await prisma.wallet.findUnique({ where: { userId: customer.id } });
      expect(customerWallet?.balance).toBe(700);

      const providerWallet = await prisma.wallet.findUnique({ where: { userId: provider.id } });
      expect(providerWallet?.balance).toBe(300);
    });

    it('WALLET: rejects with insufficient balance, and leaves the complaint in PAYMENT with no money moved (fixed 2026-09-07 — previously this was never checked at all)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'PAYMENT', totalAmount: 300,
      });
      await prisma.wallet.create({ data: { userId: customer.id, walletType: 'CUSTOMER', balance: 50 } });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/complete-payment`)
        .set('Authorization', `Bearer ${token}`)
        .send({ method: 'WALLET' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Insufficient wallet balance to complete this payment');

      const stillPayment = await prisma.complaint.findUnique({ where: { id: complaint.id } });
      expect(stillPayment?.stage).toBe('PAYMENT');

      const customerWallet = await prisma.wallet.findUnique({ where: { userId: customer.id } });
      expect(customerWallet?.balance).toBe(50);

      const providerWallet = await prisma.wallet.findUnique({ where: { userId: provider.id } });
      expect(providerWallet).toBeNull();
    });

    it('WALLET: rejects when the customer has no wallet at all with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'PAYMENT', totalAmount: 300,
      });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/complete-payment`)
        .set('Authorization', `Bearer ${token}`)
        .send({ method: 'WALLET' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Customer wallet not found');
    });

    it('rejects completion outside the PAYMENT stage with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'APPROVAL' });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/complete-payment`)
        .set('Authorization', `Bearer ${token}`)
        .send({ method: 'CASH' });

      expect(res.status).toBe(400);
    });

    it('rejects a provider not assigned to the complaint with 404', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const assignedProvider = await createUser(Role.PROVIDER);
      const unrelatedProvider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: assignedProvider.id, stage: 'PAYMENT', totalAmount: 300,
      });
      const token = signAccessToken(unrelatedProvider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/complete-payment`)
        .set('Authorization', `Bearer ${token}`)
        .send({ method: 'CASH' });

      expect(res.status).toBe(404);
    });
  });
});
