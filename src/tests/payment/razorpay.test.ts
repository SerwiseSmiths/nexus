import crypto from 'crypto';
import axios from 'axios';
import prisma from '@/services/prisma.service';
import { config } from '@/configs';
import { Role } from '@prisma/client';
import { StrapiService } from '@/services/strapi.service';
import { TelegramService } from '@/services/telegram.service';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetAllTestTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser, createAddressFor } from '../complaint/fixtures';

jest.mock('axios');
jest.mock('@/services/realtime.service', () => ({
  RealtimeService: {
    emitPaymentVerified: jest.fn().mockResolvedValue(undefined),
    emitPaymentFailed: jest.fn().mockResolvedValue(undefined),
    emitPaymentReceived: jest.fn().mockResolvedValue(undefined),
    emitStageChanged: jest.fn().mockResolvedValue(undefined),
    emitComplaintCreated: jest.fn().mockResolvedValue(undefined),
    emitProviderWalletUpdated: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('@/services/notification.service', () => ({
  NotificationService: { sendToUser: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('@/services/telegram.service', () => ({
  TelegramService: {
    notifyUnappliedPayment:   jest.fn().mockResolvedValue(undefined),
    notifyUnappliedQrPayment: jest.fn().mockResolvedValue(undefined),
    notifyPaymentVerified:    jest.fn().mockResolvedValue(undefined),
    notifySubscriptionCreated: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const WEBHOOK_SECRET = 'test_webhook_secret';

const PLAN = {
  documentId: 'p1', key: 'LITE', name: 'Lite', badge: null, badge_color: null,
  annual_price: 999, monthly_price: 99, tagline: null, max_services: 2, duration_months: 12,
  sort_order: 1, is_active: true, visit_services: [], features: [],
};
const ADDON = {
  documentId: 'a1', key: 'EXTRA_FILTER', name: 'Extra filter', price: 100, description: null,
  imageUrl: null, is_active: true, sort_order: 1, device_types: [],
};

let orderSeq = 0;
function mockRazorpayOrderCreate() {
  mockedAxios.post.mockImplementation(async (url: string, body?: unknown) => {
    if (url.endsWith('/v1/orders')) {
      orderSeq += 1;
      return { data: { id: `order_test_${orderSeq}`, amount: (body as { amount: number }).amount, currency: 'INR' } };
    }
    return { data: {} };
  });
}

function signedWebhook(app: import('express').Express, payload: object, signature?: string) {
  const raw = JSON.stringify(payload);
  const sig = signature ?? crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  return testRequest(app)
    .post('/api/payments/razorpay/webhook')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', sig)
    .send(raw);
}

function paymentEvent(event: string, orderId: string, amount: number, paymentId = 'pay_test_1', currency = 'INR') {
  return {
    entity: 'event', event, contains: ['payment'],
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency, status: 'captured', contact: null } } },
  };
}

function mockBookingQrCreate() {
  mockedAxios.post.mockImplementation(async (url: string) => {
    if (url.endsWith('/v1/payments/qr_codes')) {
      return { data: { id: 'qr_test_1', image_url: 'https://rzp.io/qr_test_1.png', image_content: 'upi://pay?pa=serwise@upi', close_by: 2_000_000_000 } };
    }
    return { data: {} };
  });
}

function qrCreditedEvent(qrId: string, amount: number, paymentId = 'pay_qr_1') {
  return {
    entity: 'event', event: 'qr_code.credited', contains: ['qr_code', 'payment'],
    payload: {
      qr_code: { entity: { id: qrId, status: 'closed', payments_amount_received: amount, notes: { purpose: 'complaint_payment' } } },
      payment: { entity: { id: paymentId, order_id: null, amount, currency: 'INR', status: 'captured', contact: null } },
    },
  };
}

async function createPendingOrder(userId: string, purpose: string, amount: number, meta: object = {}) {
  orderSeq += 1;
  return prisma.paymentOrder.create({
    data: { userId, razorpayOrderId: `order_seed_${orderSeq}`, amount, purpose, meta, status: 'PENDING' },
  });
}

describe('Razorpay payments', () => {
  let app: import('express').Express;

  beforeAll(async () => {
    app = await getTestApp();
    config.razorpay = { keyId: 'rzp_test_key', keySecret: 'rzp_test_secret', webhookSecret: WEBHOOK_SECRET };
  });

  beforeEach(async () => {
    await resetAllTestTables();
    jest.clearAllMocks();
    mockRazorpayOrderCreate();
    jest.spyOn(StrapiService, 'fetchSubscriptionPlans').mockResolvedValue([PLAN]);
    jest.spyOn(StrapiService, 'fetchSubscriptionAddons').mockResolvedValue([ADDON]);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ─── Removed endpoints ────────────────────────────────────────────────────

  describe('removed unverified endpoints', () => {
    it.each([
      ['/api/payments/razorpay/webview-complete', { paymentId: 'pay_fake', purpose: 'recharge', amountRupees: 50000 }],
      ['/api/payments/razorpay/session',          { amountRupees: 100, purpose: 'recharge' }],
      ['/api/payments/razorpay/link',             { amountRupees: 100, purpose: 'recharge' }],
      ['/api/subscription',                       { deviceTypeKey: 'fridge', planKey: 'LITE', billingCycle: 'ANNUAL', startDate: new Date().toISOString() }],
    ])('POST %s no longer exists and credits nothing', async (url, body) => {
      const customer = await createUser(Role.CUSTOMER);

      const res = await testRequest(app)
        .post(url)
        .set('Authorization', `Bearer ${signAccessToken(customer)}`)
        .send(body);

      expect(res.status).toBe(404);
      expect(await prisma.wallet.findUnique({ where: { userId: customer.id } })).toBeNull();
      expect(await prisma.subscription.count()).toBe(0);
    });
  });

  // ─── Order creation: server-side pricing ──────────────────────────────────

  describe('POST /api/payments/razorpay/order', () => {
    const order = (token: string, body: object) =>
      testRequest(app).post('/api/payments/razorpay/order').set('Authorization', `Bearer ${token}`).send(body);

    it('recharge: creates a PENDING order for a whole-rupee amount', async () => {
      const customer = await createUser(Role.CUSTOMER);

      const res = await order(signAccessToken(customer), { amount: 500_00, purpose: 'recharge' });

      expect(res.status).toBe(201);
      const saved = await prisma.paymentOrder.findFirstOrThrow({ where: { userId: customer.id } });
      expect(saved).toMatchObject({ amount: 500_00, purpose: 'recharge', status: 'PENDING' });
    });

    it.each([
      ['fractional rupees', 500_50],
      ['above the ₹1,00,000 limit', 1_00_001_00],
    ])('recharge: rejects %s with 400 and creates no Razorpay order', async (_label, amount) => {
      const customer = await createUser(Role.CUSTOMER);

      const res = await order(signAccessToken(customer), { amount, purpose: 'recharge' });

      expect(res.status).toBe(400);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('rejects an unknown purpose with 400', async () => {
      const customer = await createUser(Role.CUSTOMER);

      const res = await order(signAccessToken(customer), { amount: 100, purpose: 'free_money' });

      expect(res.status).toBe(400);
    });

    const subscriptionMeta = (addons: object[] = [{ key: 'EXTRA_FILTER', price: 0 }]) => ({
      deviceTypeKey: 'master_purifier', planKey: 'LITE', billingCycle: 'ANNUAL', addons, startDate: new Date().toISOString(),
    });

    it('subscription: accepts the CMS price and snapshots CMS addon prices, ignoring client-sent prices', async () => {
      const customer = await createUser(Role.CUSTOMER);

      const res = await order(signAccessToken(customer), { amount: 1099_00, purpose: 'subscription', meta: subscriptionMeta() });

      expect(res.status).toBe(201);
      const saved = await prisma.paymentOrder.findFirstOrThrow({ where: { userId: customer.id } });
      expect(saved.amount).toBe(1099_00);
      expect((saved.meta as { addons: object[] }).addons).toEqual([{ key: 'EXTRA_FILTER', name: 'Extra filter', price: 100 }]);
    });

    it('subscription: rejects an underpriced amount with 409 and creates no order', async () => {
      const customer = await createUser(Role.CUSTOMER);

      const res = await order(signAccessToken(customer), { amount: 1_00, purpose: 'subscription', meta: subscriptionMeta() });

      expect(res.status).toBe(409);
      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(await prisma.paymentOrder.count()).toBe(0);
    });

    it('subscription: rejects an addon that is not in the CMS with 409', async () => {
      const customer = await createUser(Role.CUSTOMER);

      const res = await order(signAccessToken(customer), {
        amount: 999_00, purpose: 'subscription', meta: subscriptionMeta([{ key: 'MADE_UP' }]),
      });

      expect(res.status).toBe(409);
    });

    it('subscription: rejects with 409 BEFORE payment when an active plan already exists for the device type', async () => {
      const customer = await createUser(Role.CUSTOMER);
      await prisma.subscription.create({
        data: {
          userId: customer.id, deviceTypeKey: 'master_purifier', planKey: 'LITE', planName: 'Lite',
          billingCycle: 'ANNUAL', planPrice: 999, totalAmount: 999, maxServices: 2,
          startDate: new Date(), endDate: new Date(Date.now() + 86_400_000), status: 'ACTIVE',
        },
      });

      const res = await order(signAccessToken(customer), { amount: 1099_00, purpose: 'subscription', meta: subscriptionMeta() });

      expect(res.status).toBe(409);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('complaint_payment: accepts exactly the ₹185 visit fee for the user\'s own address', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const address = await createAddressFor(customer.id);

      const res = await order(signAccessToken(customer), {
        amount: 185_00, purpose: 'complaint_payment',
        meta: { addressId: address.id, requestedDevices: [{ deviceKey: 'fridge', quantity: 1 }] },
      });

      expect(res.status).toBe(201);
    });

    it('complaint_payment: rejects a cheaper fee with 409', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const address = await createAddressFor(customer.id);

      const res = await order(signAccessToken(customer), {
        amount: 1_00, purpose: 'complaint_payment',
        meta: { addressId: address.id, requestedDevices: [{ deviceKey: 'fridge', quantity: 1 }] },
      });

      expect(res.status).toBe(409);
    });

    it('complaint_payment: rejects another user\'s address with 400 before taking payment', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const other = await createUser(Role.CUSTOMER);
      const othersAddress = await createAddressFor(other.id);

      const res = await order(signAccessToken(customer), {
        amount: 185_00, purpose: 'complaint_payment',
        meta: { addressId: othersAddress.id, requestedDevices: [{ deviceKey: 'fridge', quantity: 1 }] },
      });

      expect(res.status).toBe(400);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  // ─── Booking-fee QR (website) ─────────────────────────────────────────────

  describe('POST /api/payments/razorpay/booking-qr', () => {
    const bookingQr = (token: string, body: object) =>
      testRequest(app).post('/api/payments/razorpay/booking-qr').set('Authorization', `Bearer ${token}`).send(body);

    it('creates a fixed-amount UPI QR and a PENDING complaint_payment order keyed by the QR id', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const address = await createAddressFor(customer.id);
      mockBookingQrCreate();

      const res = await bookingQr(signAccessToken(customer), {
        amount: 185_00,
        meta: { addressId: address.id, requestedDevices: [{ deviceKey: 'fridge', quantity: 2 }] },
      });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ orderId: 'qr_test_1', amount: 185_00, imageContent: 'upi://pay?pa=serwise@upi' });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.razorpay.com/v1/payments/qr_codes',
        expect.objectContaining({ usage: 'single_use', fixed_amount: true, payment_amount: 185_00 }),
        expect.anything(),
      );
      const saved = await prisma.paymentOrder.findFirstOrThrow({ where: { razorpayOrderId: 'qr_test_1' } });
      expect(saved).toMatchObject({ userId: customer.id, purpose: 'complaint_payment', status: 'PENDING', amount: 185_00 });
    });

    it('rejects a fee other than ₹185 with 409 before creating any QR', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const address = await createAddressFor(customer.id);

      const res = await bookingQr(signAccessToken(customer), {
        amount: 300_00,
        meta: { addressId: address.id, requestedDevices: [{ deviceKey: 'fridge', quantity: 1 }] },
      });

      expect(res.status).toBe(409);
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  // ─── Order status ─────────────────────────────────────────────────────────

  describe('GET /api/payments/razorpay/order/:orderId', () => {
    it('returns the status of the user\'s own order', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const saved = await createPendingOrder(customer.id, 'recharge', 100_00);

      const res = await testRequest(app)
        .get(`/api/payments/razorpay/order/${saved.razorpayOrderId}`)
        .set('Authorization', `Bearer ${signAccessToken(customer)}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ orderId: saved.razorpayOrderId, purpose: 'recharge', status: 'PENDING', amount: 100_00 });
    });

    it('returns 404 for another user\'s order', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const other = await createUser(Role.CUSTOMER);
      const saved = await createPendingOrder(other.id, 'recharge', 100_00);

      const res = await testRequest(app)
        .get(`/api/payments/razorpay/order/${saved.razorpayOrderId}`)
        .set('Authorization', `Bearer ${signAccessToken(customer)}`);

      expect(res.status).toBe(404);
    });
  });

  // ─── Webhook ──────────────────────────────────────────────────────────────

  describe('POST /api/payments/razorpay/webhook', () => {
    it('rejects a wrong signature with 400', async () => {
      const res = await signedWebhook(app, paymentEvent('payment.captured', 'order_x', 100), 'a'.repeat(64));
      expect(res.status).toBe(400);
    });

    it('rejects a malformed (wrong-length) signature with 400, not 500', async () => {
      const res = await signedWebhook(app, paymentEvent('payment.captured', 'order_x', 100), 'short');
      expect(res.status).toBe(400);
    });

    it('payment.captured: credits a recharge exactly once even when Razorpay delivers it twice', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const saved = await createPendingOrder(customer.id, 'recharge', 250_00);
      const event = paymentEvent('payment.captured', saved.razorpayOrderId, 250_00);

      expect((await signedWebhook(app, event)).status).toBe(200);
      expect((await signedWebhook(app, event)).status).toBe(200);

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.id } });
      expect(wallet.balance).toBe(250);
      expect(await prisma.walletLedger.count({ where: { userId: customer.id } })).toBe(1);
      const after = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: saved.id } });
      expect(after).toMatchObject({ status: 'CAPTURED', razorpayPaymentId: 'pay_test_1' });
    });

    it('payment.captured: a paid amount that differs from the order is not applied, marked FAILED and alerted', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const saved = await createPendingOrder(customer.id, 'recharge', 250_00);

      const res = await signedWebhook(app, paymentEvent('payment.captured', saved.razorpayOrderId, 1_00));

      expect(res.status).toBe(200);
      expect(await prisma.wallet.findUnique({ where: { userId: customer.id } })).toBeNull();
      expect((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe('FAILED');
      expect(TelegramService.notifyUnappliedPayment).toHaveBeenCalledTimes(1);
    });

    it('payment.captured: a fulfilment error returns 200 (no webhook retry storm), marks FAILED and alerts', async () => {
      const customer = await createUser(Role.CUSTOMER);
      // Address no longer exists → complaint creation fails after payment.
      const saved = await createPendingOrder(customer.id, 'complaint_payment', 185_00, {
        addressId: '00000000-0000-0000-0000-000000000000', requestedDevices: [{ deviceKey: 'fridge', quantity: 1 }],
      });

      const res = await signedWebhook(app, paymentEvent('payment.captured', saved.razorpayOrderId, 185_00));

      expect(res.status).toBe(200);
      expect((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe('FAILED');
      expect(TelegramService.notifyUnappliedPayment).toHaveBeenCalledTimes(1);
    });

    it('payment.authorized: captures via the API and fulfils once Razorpay confirms the capture', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const saved = await createPendingOrder(customer.id, 'recharge', 300_00);
      mockedAxios.get.mockResolvedValue({ data: { status: 'captured' } });

      const res = await signedWebhook(app, paymentEvent('payment.authorized', saved.razorpayOrderId, 300_00));

      expect(res.status).toBe(200);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.razorpay.com/v1/payments/pay_test_1/capture',
        { amount: 300_00, currency: 'INR' },
        expect.anything(),
      );
      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer.id } });
      expect(wallet.balance).toBe(300);
    });

    it('payment.authorized: does NOT fulfil while the payment is still only authorized', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const saved = await createPendingOrder(customer.id, 'recharge', 300_00);
      mockedAxios.get.mockResolvedValue({ data: { status: 'authorized' } });

      await signedWebhook(app, paymentEvent('payment.authorized', saved.razorpayOrderId, 300_00));

      expect(await prisma.wallet.findUnique({ where: { userId: customer.id } })).toBeNull();
      expect((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe('PENDING');
    });

    it('qr_code.credited on a booking QR creates the tickets once, even when delivered twice', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const address = await createAddressFor(customer.id);
      // Every customer gets a wallet at signup; the fee is recorded on it (audit only).
      await prisma.wallet.create({ data: { userId: customer.id, walletType: 'CUSTOMER', balance: 0 } });
      const saved = await prisma.paymentOrder.create({
        data: {
          userId: customer.id, razorpayOrderId: 'qr_booking_1', amount: 185_00, purpose: 'complaint_payment', status: 'PENDING',
          meta: { addressId: address.id, serviceType: 'Service', deviceLines: 'Fridge ×1', requestedDevices: [{ deviceKey: 'fridge', quantity: 1 }] },
        },
      });
      const event = qrCreditedEvent('qr_booking_1', 185_00);

      expect((await signedWebhook(app, event)).status).toBe(200);
      expect((await signedWebhook(app, event)).status).toBe(200);

      expect(await prisma.complaint.count({ where: { userId: customer.id } })).toBe(1);
      const after = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: saved.id } });
      expect(after).toMatchObject({ status: 'CAPTURED', razorpayPaymentId: 'pay_qr_1' });
      // The duplicate delivery isn't mistaken for a provider-settlement QR
      expect(TelegramService.notifyUnappliedQrPayment).not.toHaveBeenCalled();
    });

    it('qr_code.credited on a booking QR with a different amount creates nothing, marks FAILED and alerts', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const address = await createAddressFor(customer.id);
      await prisma.paymentOrder.create({
        data: {
          userId: customer.id, razorpayOrderId: 'qr_booking_2', amount: 185_00, purpose: 'complaint_payment', status: 'PENDING',
          meta: { addressId: address.id, requestedDevices: [{ deviceKey: 'fridge', quantity: 1 }] },
        },
      });

      const res = await signedWebhook(app, qrCreditedEvent('qr_booking_2', 1_00));

      expect(res.status).toBe(200);
      expect(await prisma.complaint.count({ where: { userId: customer.id } })).toBe(0);
      expect((await prisma.paymentOrder.findFirstOrThrow({ where: { razorpayOrderId: 'qr_booking_2' } })).status).toBe('FAILED');
      expect(TelegramService.notifyUnappliedPayment).toHaveBeenCalledTimes(1);
    });

    it('payment.captured without an order id (not a Serwise order) is ignored', async () => {
      const customer = await createUser(Role.CUSTOMER);

      const res = await signedWebhook(app, {
        entity: 'event', event: 'payment.captured', contains: ['payment'],
        payload: { payment: { entity: { id: 'pay_x', order_id: null, amount: 500_00, currency: 'INR', status: 'captured', contact: '+919999999999' } } },
      });

      expect(res.status).toBe(200);
      expect(await prisma.wallet.findUnique({ where: { userId: customer.id } })).toBeNull();
    });
  });
});
