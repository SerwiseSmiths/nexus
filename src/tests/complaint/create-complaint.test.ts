import prisma from '@/services/prisma.service';
import { Role } from '@prisma/client';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetComplaintTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser, createAddressFor } from './fixtures';

jest.mock('@/services/realtime.service', () => ({
  RealtimeService: {
    emitComplaintCreated: jest.fn().mockResolvedValue(undefined),
    emitProviderAssigned: jest.fn().mockResolvedValue(undefined),
    emitProviderAccepted: jest.fn().mockResolvedValue(undefined),
    emitProviderRejected: jest.fn().mockResolvedValue(undefined),
    emitQuoteAdded: jest.fn().mockResolvedValue(undefined),
    emitQuoteResponded: jest.fn().mockResolvedValue(undefined),
    emitStageChanged: jest.fn().mockResolvedValue(undefined),
    emitQrScanRequested: jest.fn().mockResolvedValue(undefined),
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

describe('POST /api/complaint', () => {
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

  it('creates a complaint from a single requested device', async () => {
    const user = await createUser(Role.CUSTOMER);
    const address = await createAddressFor(user.id);
    const token = signAccessToken(user);

    const res = await testRequest(app)
      .post('/api/complaint')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Fridge not cooling',
        addressId: address.id,
        requestedDevices: [{ deviceKey: 'fridge', quantity: 1 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.complaint.stage).toBe('ENTRANCE');
    expect(res.body.data.complaint.requestedDevices).toEqual([{ deviceKey: 'fridge', quantity: 1 }]);
    expect(res.body.data.complaint.group).toBeTruthy();
    expect(res.body.data.complaint.devices).toEqual([]);
  });

  it('rejects an address that does not belong to the caller with 404', async () => {
    const user = await createUser(Role.CUSTOMER);
    const other = await createUser(Role.CUSTOMER);
    const otherAddress = await createAddressFor(other.id);
    const token = signAccessToken(user);

    const res = await testRequest(app)
      .post('/api/complaint')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'x', addressId: otherAddress.id, requestedDevices: [{ deviceKey: 'fridge', quantity: 1 }] });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Address not found');
  });

  it('rejects an unknown deviceKey with 400', async () => {
    const user = await createUser(Role.CUSTOMER);
    const address = await createAddressFor(user.id);
    const token = signAccessToken(user);

    const res = await testRequest(app)
      .post('/api/complaint')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'x', addressId: address.id, requestedDevices: [{ deviceKey: 'toaster', quantity: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Unknown device key: toaster');
  });

  it('rejects missing title / invalid addressId / empty requestedDevices with 400', async () => {
    const user = await createUser(Role.CUSTOMER);
    const address = await createAddressFor(user.id);
    const token = signAccessToken(user);

    const noTitle = await testRequest(app)
      .post('/api/complaint')
      .set('Authorization', `Bearer ${token}`)
      .send({ addressId: address.id, requestedDevices: [{ deviceKey: 'fridge', quantity: 1 }] });
    expect(noTitle.status).toBe(400);

    const badAddress = await testRequest(app)
      .post('/api/complaint')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'x', addressId: 'not-a-uuid', requestedDevices: [{ deviceKey: 'fridge', quantity: 1 }] });
    expect(badAddress.status).toBe(400);

    const noDevices = await testRequest(app)
      .post('/api/complaint')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'x', addressId: address.id, requestedDevices: [] });
    expect(noDevices.status).toBe(400);
  });

  it('ADMIN must supply customerId, and the complaint is owned by that customer', async () => {
    const admin = await createUser(Role.ADMIN);
    const customer = await createUser(Role.CUSTOMER);
    const address = await createAddressFor(customer.id);
    const token = signAccessToken(admin);

    const missingCustomerId = await testRequest(app)
      .post('/api/complaint')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'x', addressId: address.id, requestedDevices: [{ deviceKey: 'fridge', quantity: 1 }] });
    expect(missingCustomerId.status).toBe(400);
    expect(missingCustomerId.body.message).toBe('customerId is required when creating a ticket as ADMIN');

    const res = await testRequest(app)
      .post('/api/complaint')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'x',
        addressId: address.id,
        customerId: customer.id,
        requestedDevices: [{ deviceKey: 'fridge', quantity: 1 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.complaint.userId).toBe(customer.id);
  });

  it('creates one complaint per device-type group in a mixed batch, keeping same-group devices together', async () => {
    const user = await createUser(Role.CUSTOMER);
    const address = await createAddressFor(user.id);
    const token = signAccessToken(user);

    // fridge + geyser are each in their own standard group (seeded 1:1 with
    // DeviceType), so this should split into 2 complaints — not 1, not 3.
    const res = await testRequest(app)
      .post('/api/complaint')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Multi-device batch',
        addressId: address.id,
        requestedDevices: [
          { deviceKey: 'fridge', quantity: 2 },
          { deviceKey: 'geyser', quantity: 1 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.complaints).toHaveLength(2);

    const complaints = await prisma.complaint.findMany({ where: { userId: user.id } });
    expect(complaints).toHaveLength(2);
    const groupIds = new Set(complaints.map((c) => c.groupId));
    expect(groupIds.size).toBe(2);
  });

  it('creates nothing when any requested device in the batch is invalid', async () => {
    const user = await createUser(Role.CUSTOMER);
    const address = await createAddressFor(user.id);
    const token = signAccessToken(user);

    const res = await testRequest(app)
      .post('/api/complaint')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Multi-device batch',
        addressId: address.id,
        requestedDevices: [
          { deviceKey: 'fridge', quantity: 1 },
          { deviceKey: 'toaster', quantity: 1 },
        ],
      });

    expect(res.status).toBe(400);

    const complaints = await prisma.complaint.findMany({ where: { userId: user.id } });
    expect(complaints).toHaveLength(0);
  });

  it('rejects a PROVIDER caller with 403 (role gate)', async () => {
    const provider = await createUser(Role.PROVIDER);
    const address = await createAddressFor(provider.id);
    const token = signAccessToken(provider);

    const res = await testRequest(app)
      .post('/api/complaint')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'x', addressId: address.id, requestedDevices: [{ deviceKey: 'fridge', quantity: 1 }] });

    expect(res.status).toBe(403);
  });

  it('rejects with 401 when no token is provided', async () => {
    const res = await testRequest(app).post('/api/complaint').send({ title: 'x', addressId: 'x' });
    expect(res.status).toBe(401);
  });
});
