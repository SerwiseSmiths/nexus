import prisma from '@/services/prisma.service';
import { Role } from '@prisma/client';
import { WalletService } from '@/services/wallet.service';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetAllTestTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser } from '../complaint/fixtures';

jest.mock('@/services/realtime.service', () => ({
  RealtimeService: { emitProviderWalletUpdated: jest.fn().mockResolvedValue(undefined) },
}));

describe('Wallet money movements', () => {
  let app: import('express').Express;

  beforeAll(async () => {
    app = await getTestApp();
  });

  beforeEach(async () => {
    await resetAllTestTables();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function providerWithBalance(balance: number) {
    const provider = await createUser(Role.PROVIDER);
    await prisma.wallet.create({ data: { userId: provider.id, walletType: 'PROVIDER', balance } });
    return provider;
  }

  describe('admin POST /api/wallet/debit (watchtower manual payout)', () => {
    it('a retried request with the same idempotencyKey debits only once', async () => {
      const admin = await createUser(Role.ADMIN);
      const provider = await providerWithBalance(1000);
      const body = { userId: provider.id, amount: 400, source: 'WITHDRAWAL', idempotencyKey: 'payout-abc-123' };

      const first  = await testRequest(app).post('/api/wallet/debit').set('Authorization', `Bearer ${signAccessToken(admin)}`).send(body);
      const second = await testRequest(app).post('/api/wallet/debit').set('Authorization', `Bearer ${signAccessToken(admin)}`).send(body);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.data.ledger.id).toBe(first.body.data.ledger.id);
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: provider.id } });
      expect(wallet.balance).toBe(600);
      expect(await prisma.walletLedger.count({ where: { userId: provider.id } })).toBe(1);
    });

    it.each([
      ['more than 2 decimal places', 10.005],
      ['above ₹1,00,000', 100_001],
      ['zero', 0],
      ['negative', -50],
    ])('rejects an amount that is %s with 400', async (_label, amount) => {
      const admin = await createUser(Role.ADMIN);
      const provider = await providerWithBalance(1000);

      const res = await testRequest(app)
        .post('/api/wallet/debit')
        .set('Authorization', `Bearer ${signAccessToken(admin)}`)
        .send({ userId: provider.id, amount, source: 'WITHDRAWAL' });

      expect(res.status).toBe(400);
      expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: provider.id } })).balance).toBe(1000);
    });

    it('rejects a non-admin with 403', async () => {
      const provider = await providerWithBalance(1000);

      const res = await testRequest(app)
        .post('/api/wallet/credit')
        .set('Authorization', `Bearer ${signAccessToken(provider)}`)
        .send({ userId: provider.id, amount: 5000, source: 'ADMIN_ADJUSTMENT' });

      expect(res.status).toBe(403);
    });
  });

  describe('concurrent credits', () => {
    it('ten simultaneous credits all land (no lost update)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      await prisma.wallet.create({ data: { userId: customer.id, walletType: 'CUSTOMER', balance: 0 } });

      await Promise.all(
        Array.from({ length: 10 }, () =>
          WalletService.creditWallet({ userId: customer.id, amount: 10, source: 'RECHARGE' }),
        ),
      );

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.id } });
      expect(wallet.balance).toBe(100);
      const ledger = await prisma.walletLedger.findMany({ where: { userId: customer.id } });
      expect(ledger).toHaveLength(10);
      // Each row's closing balance is consistent with its own opening balance.
      for (const row of ledger) expect(row.closingBalance).toBeCloseTo(row.openingBalance + 10, 2);
    });
  });

  describe('provider payout requests', () => {
    it('rejects a new request when pending requests already reserve the balance', async () => {
      const provider = await providerWithBalance(1000);
      const token = signAccessToken(provider);

      const first  = await testRequest(app).post('/api/wallet/payout-requests').set('Authorization', `Bearer ${token}`).send({ amount: 700 });
      const second = await testRequest(app).post('/api/wallet/payout-requests').set('Authorization', `Bearer ${token}`).send({ amount: 700 });

      expect(first.status).toBe(201);
      expect(second.status).toBe(400);
      expect(await prisma.payoutRequest.count({ where: { userId: provider.id } })).toBe(1);
    });

    it('approving twice debits once and the second call gets 409', async () => {
      const admin = await createUser(Role.ADMIN);
      const provider = await providerWithBalance(1000);
      const request = await prisma.payoutRequest.create({
        data: { userId: provider.id, walletId: (await prisma.wallet.findUniqueOrThrow({ where: { userId: provider.id } })).id, amount: 400 },
      });
      const approve = () => testRequest(app)
        .patch(`/api/wallet/payout-requests/${request.id}`)
        .set('Authorization', `Bearer ${signAccessToken(admin)}`)
        .send({ status: 'APPROVED' });

      expect((await approve()).status).toBe(200);
      expect((await approve()).status).toBe(409);

      expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: provider.id } })).balance).toBe(600);
    });

    it('two admins approving at the same moment debit only once', async () => {
      const admin = await createUser(Role.ADMIN);
      const provider = await providerWithBalance(1000);
      const request = await prisma.payoutRequest.create({
        data: { userId: provider.id, walletId: (await prisma.wallet.findUniqueOrThrow({ where: { userId: provider.id } })).id, amount: 400 },
      });

      const results = await Promise.all([1, 2].map(() =>
        testRequest(app)
          .patch(`/api/wallet/payout-requests/${request.id}`)
          .set('Authorization', `Bearer ${signAccessToken(admin)}`)
          .send({ status: 'APPROVED' }),
      ));

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: provider.id } })).balance).toBe(600);
      expect(await prisma.walletLedger.count({ where: { userId: provider.id, source: 'WITHDRAWAL' } })).toBe(1);
    });

    it('APPROVED → PAID records the payout without a second debit', async () => {
      const admin = await createUser(Role.ADMIN);
      const provider = await providerWithBalance(1000);
      const request = await prisma.payoutRequest.create({
        data: { userId: provider.id, walletId: (await prisma.wallet.findUniqueOrThrow({ where: { userId: provider.id } })).id, amount: 400 },
      });
      const patch = (status: string) => testRequest(app)
        .patch(`/api/wallet/payout-requests/${request.id}`)
        .set('Authorization', `Bearer ${signAccessToken(admin)}`)
        .send({ status });

      expect((await patch('APPROVED')).status).toBe(200);
      const paid = await patch('PAID');

      expect(paid.status).toBe(200);
      expect(paid.body.data.status).toBe('PAID');
      expect((await prisma.wallet.findUniqueOrThrow({ where: { userId: provider.id } })).balance).toBe(600);
    });

    it('an approved request can no longer be rejected (the debit is already done)', async () => {
      const admin = await createUser(Role.ADMIN);
      const provider = await providerWithBalance(1000);
      const request = await prisma.payoutRequest.create({
        data: { userId: provider.id, walletId: (await prisma.wallet.findUniqueOrThrow({ where: { userId: provider.id } })).id, amount: 400, status: 'APPROVED' },
      });

      const res = await testRequest(app)
        .patch(`/api/wallet/payout-requests/${request.id}`)
        .set('Authorization', `Bearer ${signAccessToken(admin)}`)
        .send({ status: 'REJECTED' });

      expect(res.status).toBe(409);
    });
  });
});
