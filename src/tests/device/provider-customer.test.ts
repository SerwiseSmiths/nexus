import prisma from '@/services/prisma.service';
import { Role } from '@prisma/client';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetDeviceTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser, createAddressFor, createComplaintLink, VALID_METADATA } from './fixtures';

// Covers the authorization gap fixed 2026-09-07: a PROVIDER/ADMIN could
// previously read or add devices for ANY customer via these two endpoints
// just by knowing/guessing a userId, with no check that the provider was
// actually assigned to that customer. See device.service.ts's
// assertProviderCanAccessCustomer and nexus/docs/device.md.
describe('Provider-facing device endpoints (authorization)', () => {
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

  describe('GET /api/device/customer/:userId', () => {
    it('allows a provider who has an existing complaint with the customer', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      await createComplaintLink(customer.id, provider.id, address.id);
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .get(`/api/device/customer/${customer.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.devices).toEqual([]);
    });

    it('rejects a provider with no relationship to the customer: 403', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const unrelatedProvider = await createUser(Role.PROVIDER);
      const token = signAccessToken(unrelatedProvider);

      const res = await testRequest(app)
        .get(`/api/device/customer/${customer.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You are not assigned to this customer');
    });

    it('allows ADMIN regardless of any relationship to the customer', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const admin = await createUser(Role.ADMIN);
      const token = signAccessToken(admin);

      const res = await testRequest(app)
        .get(`/api/device/customer/${customer.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    it('does not count a soft-deleted complaint as an active relationship: 403', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintLink(customer.id, provider.id, address.id);
      await prisma.complaint.update({ where: { id: complaint.id }, data: { isDeleted: true } });
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .get(`/api/device/customer/${customer.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it('rejects a CUSTOMER-role caller with 403 (role gate, before the relationship check)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const otherCustomer = await createUser(Role.CUSTOMER);
      const token = signAccessToken(otherCustomer);

      const res = await testRequest(app)
        .get(`/api/device/customer/${customer.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toBe("You don't have permission to perform this action");
    });
  });

  describe('POST /api/device/for-customer', () => {
    it('allows a provider who has an existing complaint with the customer', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      await createComplaintLink(customer.id, provider.id, address.id);
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .post('/api/device/for-customer')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetUserId: customer.id, deviceKey: 'fridge', metadata: VALID_METADATA.fridge });

      expect(res.status).toBe(201);
      expect(res.body.data.device.userId).toBe(customer.id);
    });

    it('rejects a provider with no relationship to the customer: 403, and creates no device', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const unrelatedProvider = await createUser(Role.PROVIDER);
      const token = signAccessToken(unrelatedProvider);

      const res = await testRequest(app)
        .post('/api/device/for-customer')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetUserId: customer.id, deviceKey: 'fridge', metadata: VALID_METADATA.fridge });

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('You are not assigned to this customer');

      const devices = await prisma.device.findMany({ where: { userId: customer.id } });
      expect(devices).toHaveLength(0);
    });

    it('allows ADMIN regardless of any relationship to the customer', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const admin = await createUser(Role.ADMIN);
      const token = signAccessToken(admin);

      const res = await testRequest(app)
        .post('/api/device/for-customer')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetUserId: customer.id, deviceKey: 'geyser', metadata: VALID_METADATA.geyser });

      expect(res.status).toBe(201);
    });

    it('rejects a missing targetUserId with 400', async () => {
      const provider = await createUser(Role.PROVIDER);
      const token = signAccessToken(provider);

      const res = await testRequest(app)
        .post('/api/device/for-customer')
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceKey: 'fridge', metadata: VALID_METADATA.fridge });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('targetUserId is required');
    });

    it('rejects a CUSTOMER-role caller with 403 (role gate)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const otherCustomer = await createUser(Role.CUSTOMER);
      const token = signAccessToken(otherCustomer);

      const res = await testRequest(app)
        .post('/api/device/for-customer')
        .set('Authorization', `Bearer ${token}`)
        .send({ targetUserId: customer.id, deviceKey: 'fridge', metadata: VALID_METADATA.fridge });

      expect(res.status).toBe(403);
    });
  });
});
