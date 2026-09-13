import prisma from '@/services/prisma.service';
import { Role } from '@prisma/client';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetComplaintTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser, createAddressFor, createComplaintFor, createDeviceFor, createProviderWithSkills, VALID_METADATA } from './fixtures';

jest.mock('@/services/realtime.service', () => ({
  RealtimeService: {
    emitComplaintCreated: jest.fn().mockResolvedValue(undefined),
    emitProviderAssigned: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('@/services/notification.service', () => ({
  NotificationService: { sendToUser: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('@/services/telegram.service', () => ({
  TelegramService: {
    notifyNoProviderMatch: jest.fn().mockResolvedValue(undefined),
    notifyComplaintCreated: jest.fn().mockResolvedValue(undefined),
  },
}));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('PATCH /api/complaint/:id/device', () => {
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

  it('the assigned provider links an existing device belonging to the complaint customer', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const provider = await createUser(Role.PROVIDER);
    const address = await createAddressFor(customer.id);
    const device = await createDeviceFor(customer.id, 'fridge');
    const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'QR_VALIDATED' });
    const token = signAccessToken(provider);

    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/device`)
      .set('Authorization', `Bearer ${token}`)
      .send({ devices: [{ deviceId: device.id }] });

    expect(res.status).toBe(200);
    expect(res.body.data.complaint.devices).toHaveLength(1);
    expect(res.body.data.complaint.devices[0].device.id).toBe(device.id);
    expect(res.body.data.complaint.stage).toBe('ESTIMATION');
  });

  it('the assigned provider identifies a brand-new device via deviceKey + metadata', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const provider = await createUser(Role.PROVIDER);
    const address = await createAddressFor(customer.id);
    const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'QR_VALIDATED' });
    const token = signAccessToken(provider);

    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/device`)
      .set('Authorization', `Bearer ${token}`)
      .send({ devices: [{ deviceKey: 'fridge', metadata: VALID_METADATA.fridge }] });

    expect(res.status).toBe(200);
    expect(res.body.data.complaint.devices).toHaveLength(1);
    expect(res.body.data.complaint.devices[0].device.deviceKey).toBe('fridge');

    const createdDevice = await prisma.device.findFirst({ where: { userId: customer.id, deviceKey: 'fridge' } });
    expect(createdDevice).toBeTruthy();
  });

  it('links multiple devices in one call', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const provider = await createUser(Role.PROVIDER);
    const address = await createAddressFor(customer.id);
    const deviceA = await createDeviceFor(customer.id, 'fridge');
    const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id, stage: 'QR_VALIDATED' });
    const token = signAccessToken(provider);

    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/device`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        devices: [
          { deviceId: deviceA.id },
          { deviceKey: 'fridge', metadata: VALID_METADATA.fridge },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.complaint.devices).toHaveLength(2);
  });

  it('rejects an item with neither deviceId nor deviceKey, and one with both, with 400', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const address = await createAddressFor(customer.id);
    const device = await createDeviceFor(customer.id, 'fridge');
    const complaint = await createComplaintFor(customer.id, address.id);
    const token = signAccessToken(customer);

    const neither = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/device`)
      .set('Authorization', `Bearer ${token}`)
      .send({ devices: [{}] });
    expect(neither.status).toBe(400);

    const both = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/device`)
      .set('Authorization', `Bearer ${token}`)
      .send({ devices: [{ deviceId: device.id, deviceKey: 'fridge' }] });
    expect(both.status).toBe(400);
  });

  it('the owning customer can also link a device', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const address = await createAddressFor(customer.id);
    const device = await createDeviceFor(customer.id, 'geyser');
    const complaint = await createComplaintFor(customer.id, address.id);
    const token = signAccessToken(customer);

    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/device`)
      .set('Authorization', `Bearer ${token}`)
      .send({ devices: [{ deviceId: device.id }] });

    expect(res.status).toBe(200);
  });

  it('rejects a device belonging to a different user with 404', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const other = await createUser(Role.CUSTOMER);
    const provider = await createUser(Role.PROVIDER);
    const address = await createAddressFor(customer.id);
    const foreignDevice = await createDeviceFor(other.id, 'fridge');
    const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
    const token = signAccessToken(provider);

    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/device`)
      .set('Authorization', `Bearer ${token}`)
      .send({ devices: [{ deviceId: foreignDevice.id }] });

    expect(res.status).toBe(404);
  });

  it('rejects a provider who is not assigned to this complaint with 404 (standardized 2026-09-12 — was 403)', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const assignedProvider = await createUser(Role.PROVIDER);
    const unrelatedProvider = await createUser(Role.PROVIDER);
    const address = await createAddressFor(customer.id);
    const device = await createDeviceFor(customer.id, 'fridge');
    const complaint = await createComplaintFor(customer.id, address.id, { providerId: assignedProvider.id });
    const token = signAccessToken(unrelatedProvider);

    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/device`)
      .set('Authorization', `Bearer ${token}`)
      .send({ devices: [{ deviceId: device.id }] });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Complaint not found or not assigned to you');
  });

  it('rejects a different customer (not the owner) with 404 (standardized 2026-09-12 — was 403)', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const other = await createUser(Role.CUSTOMER);
    const address = await createAddressFor(customer.id);
    const device = await createDeviceFor(customer.id, 'fridge');
    const complaint = await createComplaintFor(customer.id, address.id);
    const token = signAccessToken(other);

    const res = await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/device`)
      .set('Authorization', `Bearer ${token}`)
      .send({ devices: [{ deviceId: device.id }] });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/complaint/:id/reopen', () => {
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

  it('creates a fresh child complaint from a COMPLETED one', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const address = await createAddressFor(customer.id);
    const original = await createComplaintFor(customer.id, address.id, { stage: 'COMPLETED' });
    const token = signAccessToken(customer);

    const res = await testRequest(app)
      .post(`/api/complaint/${original.id}/reopen`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.complaint.parentId).toBe(original.id);
    expect(res.body.data.complaint.stage).toBe('ENTRANCE');
    expect(res.body.data.complaint.id).not.toBe(original.id);
    expect(res.body.data.complaint.groupId).toBe(original.groupId);
  });

  it('carries over already-identified devices from the original complaint', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const address = await createAddressFor(customer.id);
    const device = await createDeviceFor(customer.id, 'fridge');
    const original = await createComplaintFor(customer.id, address.id, { stage: 'COMPLETED' });
    await prisma.complaintDevice.create({ data: { complaintId: original.id, deviceId: device.id } });
    const token = signAccessToken(customer);

    const res = await testRequest(app)
      .post(`/api/complaint/${original.id}/reopen`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.complaint.devices).toHaveLength(1);
    expect(res.body.data.complaint.devices[0].device.id).toBe(device.id);
  });

  it('rejects reopening a complaint that is still active (not COMPLETED/REJECTED) with 400', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const address = await createAddressFor(customer.id);
    const active = await createComplaintFor(customer.id, address.id, { stage: 'ESTIMATION' });
    const token = signAccessToken(customer);

    const res = await testRequest(app)
      .post(`/api/complaint/${active.id}/reopen`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('re-triggers auto-assignment on the new complaint (fixed 2026-09-07 — previously reopened complaints stayed unassigned despite the "finding a provider" notification)', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const eligibleProvider = await createProviderWithSkills(['fridge']);
    const address = await createAddressFor(customer.id);
    const original = await createComplaintFor(customer.id, address.id, { stage: 'REJECTED' });
    const token = signAccessToken(customer);

    const res = await testRequest(app)
      .post(`/api/complaint/${original.id}/reopen`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(201);
    const newComplaintId = res.body.data.complaint.id;

    await wait(300);

    const reopened = await prisma.complaint.findUnique({ where: { id: newComplaintId } });
    expect(reopened?.providerId).toBe(eligibleProvider.id);
  });

  it('rejects reopening someone else\'s complaint with 404', async () => {
    const customer = await createUser(Role.CUSTOMER);
    const other = await createUser(Role.CUSTOMER);
    const address = await createAddressFor(customer.id);
    const original = await createComplaintFor(customer.id, address.id, { stage: 'COMPLETED' });
    const token = signAccessToken(other);

    const res = await testRequest(app)
      .post(`/api/complaint/${original.id}/reopen`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(404);
  });
});
