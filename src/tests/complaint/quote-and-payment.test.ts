import prisma from '@/services/prisma.service';
import { ComplaintService } from '@/services/complaint.service';
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
    emitPaymentReceived: jest.fn().mockResolvedValue(undefined),
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
        .send({ items: [{ name: 'Compressor replacement', unitPrice: 1500, quantity: 1, labour: 700 }] });

      expect(res.status).toBe(201);
      expect(res.body.data.quote.totalAmount).toBe(1500);
      expect(res.body.data.complaint.stage).toBe('APPROVAL');
    });

    it('rejects a custom (non-catalogue) item with no labour with a 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'ESTIMATION' });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/quote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ name: 'Compressor replacement', unitPrice: 1500, quantity: 1 }] });

      expect(res.status).toBe(400);
    });

    it('rejects a custom item whose labour exceeds its unit price with a 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'ESTIMATION' });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/quote`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ name: 'Compressor replacement', unitPrice: 1500, quantity: 1, labour: 2000 }] });

      expect(res.status).toBe(400);
    });

    describe('revising a pending quote (Â§6.7)', () => {
      const revisedItems = [{ name: 'Gas top-up', unitPrice: 600, quantity: 2, labour: 250 }];

      it('lets an admin edit a quote awaiting approval â€” stage stays APPROVAL, logged as QUOTE_UPDATED', async () => {
        const customer = await createUser(Role.CUSTOMER);
        const provider = await createUser(Role.PROVIDER);
        const admin = await createUser(Role.ADMIN);
        const address = await createAddressFor(customer.id);
        const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'APPROVAL', totalAmount: 1500 });

        const res = await testRequest(app)
          .post(`/api/complaint/${complaint.id}/quote`)
          .set('Authorization', `Bearer ${signAccessToken(admin)}`)
          .send({ items: revisedItems, notes: 'Customer chose the cheaper fix' });

        expect(res.status).toBe(201);
        expect(res.body.data.quote.totalAmount).toBe(1200);
        expect(res.body.data.quote.status).toBe('PENDING');
        expect(res.body.data.complaint.stage).toBe('APPROVAL');

        const log = await prisma.complaintLog.findFirst({ where: { complaintId: complaint.id, event: 'QUOTE_UPDATED' } });
        expect(log?.metadata).toEqual({ totalAmount: 1200, previousTotal: 1500 });
      });

      it('rejects the assigned provider editing a quote awaiting approval with 403', async () => {
        const customer = await createUser(Role.CUSTOMER);
        const provider = await createUser(Role.PROVIDER);
        const address = await createAddressFor(customer.id);
        const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'APPROVAL', totalAmount: 1500 });

        const res = await testRequest(app)
          .post(`/api/complaint/${complaint.id}/quote`)
          .set('Authorization', `Bearer ${signAccessToken(provider)}`)
          .send({ items: revisedItems });

        expect(res.status).toBe(403);
        const quote = await prisma.quote.findUnique({ where: { complaintId: complaint.id } });
        expect(quote?.totalAmount).toBe(1500);
      });

      it('rejects an admin edit once the customer has already approved (stage moved on) with 400', async () => {
        const customer = await createUser(Role.CUSTOMER);
        const provider = await createUser(Role.PROVIDER);
        const admin = await createUser(Role.ADMIN);
        const address = await createAddressFor(customer.id);
        const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'IN_PROGRESS', totalAmount: 1500 });
        await prisma.quote.update({ where: { complaintId: complaint.id }, data: { status: 'APPROVED' } });

        const res = await testRequest(app)
          .post(`/api/complaint/${complaint.id}/quote`)
          .set('Authorization', `Bearer ${signAccessToken(admin)}`)
          .send({ items: revisedItems });

        expect(res.status).toBe(400);
        const quote = await prisma.quote.findUnique({ where: { complaintId: complaint.id } });
        expect(quote?.status).toBe('APPROVED');
        expect(quote?.totalAmount).toBe(1500);
      });
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
    it('customer approves a non-zero quote â†’ stage IN_PROGRESS (repair starts, not payment yet)', async () => {
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

    it('customer approves a zero-amount quote â†’ stage COMPLETED directly (skips payment)', async () => {
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

    it('customer rejects a quote â†’ stage REJECTED, quote marked REJECTED', async () => {
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

    it('rejects a missing "approved" field with a friendly 400 message (fixed 2026-09-12 â€” was a raw Zod message)', async () => {
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

  describe('PATCH /api/complaint/:id/complete-service (new â€” added with the IN_PROGRESS stage)', () => {
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

    it('an ADMIN can mark the work done on the provider\'s behalf (watchtower), logged as ADMIN', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const admin = await createUser(Role.ADMIN);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'IN_PROGRESS', totalAmount: 500,
      });

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/complete-service`)
        .set('Authorization', `Bearer ${signAccessToken(admin)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.complaint.stage).toBe('PAYMENT');
      const log = await prisma.complaintLog.findFirst({ where: { complaintId: complaint.id, toStage: 'PAYMENT' } });
      expect(log).toMatchObject({ actorId: admin.id, actorRole: 'ADMIN' });
    });

    it('rejects an ADMIN outside IN_PROGRESS with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const admin = await createUser(Role.ADMIN);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, {
        providerId: provider.id, stage: 'PAYMENT', totalAmount: 500,
      });

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/complete-service`)
        .set('Authorization', `Bearer ${signAccessToken(admin)}`);

      expect(res.status).toBe(400);
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
    it('rejects a missing/invalid method with a friendly 400 message (fixed 2026-09-12 â€” was a raw Zod message)', async () => {
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

    it('CASH: with a labour-split quote, credits labour then debits the full cash collected, netting the non-labour amount owed to the company (fixed 2026-09-27 â€” previously credited the full total, double-counting cash the provider already held)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'PAYMENT' });
      await prisma.quote.create({
        data: {
          complaintId: complaint.id,
          items: [{ name: 'Compressor replacement', unitPrice: 600, quantity: 1, labour: 300 }],
          totalAmount: 600,
        },
      });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/complete-payment`)
        .set('Authorization', `Bearer ${token}`)
        .send({ method: 'CASH' });

      expect(res.status).toBe(200);

      const providerWallet = await prisma.wallet.findUnique({ where: { userId: provider.id } });
      expect(providerWallet?.balance).toBe(300 - 600); // credited 300 labour, then debited the full 600 collected in cash

      const ledger = await prisma.walletLedger.findMany({ where: { walletId: providerWallet!.id }, orderBy: { createdAt: 'asc' } });
      expect(ledger).toHaveLength(2);
      expect(ledger[0]).toMatchObject({ type: 'CREDIT', amount: 300 });
      expect(ledger[1]).toMatchObject({ type: 'DEBIT', amount: 600 });
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

    it('WALLET: with a labour-split quote, credits only labour â€” the company keeps the rest since it already collected the full amount from the customer\'s wallet (fixed 2026-09-27)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'PAYMENT' });
      await prisma.quote.create({
        data: {
          complaintId: complaint.id,
          items: [{ name: 'Compressor replacement', unitPrice: 600, quantity: 1, labour: 300 }],
          totalAmount: 600,
        },
      });
      await prisma.wallet.create({ data: { userId: customer.id, walletType: 'CUSTOMER', balance: 1000 } });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .patch(`/api/complaint/${complaint.id}/complete-payment`)
        .set('Authorization', `Bearer ${token}`)
        .send({ method: 'WALLET' });

      expect(res.status).toBe(200);

      const customerWallet = await prisma.wallet.findUnique({ where: { userId: customer.id } });
      expect(customerWallet?.balance).toBe(400); // full 600 debited from the customer

      const providerWallet = await prisma.wallet.findUnique({ where: { userId: provider.id } });
      expect(providerWallet?.balance).toBe(300); // only labour credited â€” no debit needed, company already holds the rest

      const ledger = await prisma.walletLedger.findMany({ where: { walletId: providerWallet!.id } });
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ type: 'CREDIT', amount: 300 });
    });

    it('WALLET: rejects with insufficient balance, and leaves the complaint in PAYMENT with no money moved (fixed 2026-09-07 â€” previously this was never checked at all)', async () => {
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

  describe('POST /api/complaint/:id/record-cash (ADMIN)', () => {
    async function paymentStageComplaintWithSplit() {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const admin = await createUser(Role.ADMIN);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'PAYMENT' });
      await prisma.quote.create({
        data: {
          complaintId: complaint.id,
          items: [{ name: 'Compressor replacement', unitPrice: 600, quantity: 1, labour: 300 }],
          totalAmount: 600,
        },
      });
      return { customer, provider, admin, complaint };
    }

    it('closes the complaint, credits the provider labour only (no cash offset), and writes an audit-only CASH entry on the customer ledger', async () => {
      const { customer, provider, admin, complaint } = await paymentStageComplaintWithSplit();
      await prisma.wallet.create({ data: { userId: customer.id, walletType: 'CUSTOMER', balance: 1000 } });

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/record-cash`)
        .set('Authorization', `Bearer ${signAccessToken(admin)}`)
        .send({ note: 'Paid at shop' });

      expect(res.status).toBe(200);
      expect(res.body.data.complaint.stage).toBe('COMPLETED');

      const providerWallet = await prisma.wallet.findUnique({ where: { userId: provider.id } });
      expect(providerWallet?.balance).toBe(300);
      const providerLedger = await prisma.walletLedger.findMany({ where: { walletId: providerWallet!.id } });
      expect(providerLedger).toHaveLength(1);
      expect(providerLedger[0]).toMatchObject({ type: 'CREDIT', amount: 300, paymentProvider: 'CASH' });

      const customerWallet = await prisma.wallet.findUnique({ where: { userId: customer.id } });
      expect(customerWallet?.balance).toBe(1000); // wallet balance never used
      const customerLedger = await prisma.walletLedger.findMany({ where: { walletId: customerWallet!.id } });
      expect(customerLedger).toHaveLength(1);
      expect(customerLedger[0]).toMatchObject({
        type: 'DEBIT', amount: 600, paymentProvider: 'CASH', updateBalance: false, refId: complaint.id,
      });
      expect(customerLedger[0].meta).toMatchObject({ method: 'ADMIN_CASH', collectedBy: 'ADMIN', adminId: admin.id, note: 'Paid at shop' });

      const log = await prisma.complaintLog.findFirst({ where: { complaintId: complaint.id, toStage: 'COMPLETED' } });
      expect(log).toMatchObject({ actorId: admin.id, actorRole: 'ADMIN' });
    });

    it('creates the customer wallet for the audit entry when they never had one', async () => {
      const { customer, admin, complaint } = await paymentStageComplaintWithSplit();

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/record-cash`)
        .set('Authorization', `Bearer ${signAccessToken(admin)}`)
        .send({});

      expect(res.status).toBe(200);
      const customerWallet = await prisma.wallet.findUnique({ where: { userId: customer.id } });
      expect(customerWallet).toMatchObject({ walletType: 'CUSTOMER', balance: 0 });
    });

    it('rejects a second settlement of the same complaint with 400 and moves no more money', async () => {
      const { provider, admin, complaint } = await paymentStageComplaintWithSplit();
      const token = signAccessToken(admin);

      await testRequest(app).post(`/api/complaint/${complaint.id}/record-cash`).set('Authorization', `Bearer ${token}`).send({});
      const again = await testRequest(app).post(`/api/complaint/${complaint.id}/record-cash`).set('Authorization', `Bearer ${token}`).send({});

      expect(again.status).toBe(400);
      const providerWallet = await prisma.wallet.findUnique({ where: { userId: provider.id } });
      expect(providerWallet?.balance).toBe(300);
    });

    it('rejects outside the PAYMENT stage with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const admin = await createUser(Role.ADMIN);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'IN_PROGRESS', totalAmount: 300 });

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/record-cash`)
        .set('Authorization', `Bearer ${signAccessToken(admin)}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('is ADMIN-only â€” a provider gets 403', async () => {
      const { provider, complaint } = await paymentStageComplaintWithSplit();

      const res = await testRequest(app)
        .post(`/api/complaint/${complaint.id}/record-cash`)
        .set('Authorization', `Bearer ${signAccessToken(provider)}`)
        .send({});

      expect(res.status).toBe(403);
    });
  });

  describe('ComplaintService.settleViaUpiQr (Razorpay qr_code.credited webhook)', () => {
    it('closes the complaint, credits provider labour only, and writes an audit-only RAZORPAY entry on the customer ledger', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'PAYMENT' });
      await prisma.quote.create({
        data: {
          complaintId: complaint.id,
          items: [{ name: 'Compressor replacement', unitPrice: 600, quantity: 1, labour: 300 }],
          totalAmount: 600,
        },
      });

      const updated = await ComplaintService.settleViaUpiQr({
        complaintId: complaint.id, qrId: 'qr_test', razorpayPaymentId: 'pay_test', amountPaidPaise: 60000,
      });

      expect(updated.stage).toBe('COMPLETED');
      const providerWallet = await prisma.wallet.findUnique({ where: { userId: provider.id } });
      expect(providerWallet?.balance).toBe(300);
      const customerLedger = await prisma.walletLedger.findMany({ where: { userId: customer.id } });
      expect(customerLedger).toHaveLength(1);
      expect(customerLedger[0]).toMatchObject({ type: 'DEBIT', amount: 600, paymentProvider: 'RAZORPAY', updateBalance: false });
    });

    it('refuses an underpayment and leaves the complaint in PAYMENT', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'PAYMENT', totalAmount: 600 });

      await expect(ComplaintService.settleViaUpiQr({
        complaintId: complaint.id, qrId: 'qr_test', razorpayPaymentId: 'pay_test', amountPaidPaise: 100,
      })).rejects.toThrow();

      const still = await prisma.complaint.findUnique({ where: { id: complaint.id } });
      expect(still?.stage).toBe('PAYMENT');
    });
  });
});
