import { DeviceType, ProviderSignupStatus, Role } from '@prisma/client';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetAllTestTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import prisma from '@/services/prisma.service';

const PHONE = '9876500001';

const validBody = {
  firstName: 'Ravi',
  lastName: 'Patel',
  phoneNo: PHONE,
  city: 'Surat',
  deviceTypes: [DeviceType.AIR_CONDITIONER, DeviceType.FRIDGE],
  experienceYears: 4,
};

const adminToken = () => signAccessToken({ id: 'test-admin', phoneNo: '0000000000', role: Role.ADMIN });

describe('Provider signup requests', () => {
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

  describe('POST /api/provider-signup (public)', () => {
    it('stores a PENDING request without auth', async () => {
      const res = await testRequest(app).post('/api/provider-signup').send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.data.request.status).toBe(ProviderSignupStatus.PENDING);

      const rows = await prisma.providerSignupRequest.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ phoneNo: PHONE, city: 'Surat', experienceYears: 4 });
      expect(rows[0].deviceTypes.sort()).toEqual([DeviceType.AIR_CONDITIONER, DeviceType.FRIDGE].sort());
    });

    it('rejects an invalid phone number', async () => {
      const res = await testRequest(app).post('/api/provider-signup').send({ ...validBody, phoneNo: '12345' });
      expect(res.status).toBe(400);
    });

    it('requires at least one appliance', async () => {
      const res = await testRequest(app).post('/api/provider-signup').send({ ...validBody, deviceTypes: [] });
      expect(res.status).toBe(400);
    });

    it('updates the pending request on re-submit instead of duplicating it', async () => {
      await testRequest(app).post('/api/provider-signup').send(validBody);
      const res = await testRequest(app)
        .post('/api/provider-signup')
        .send({ ...validBody, city: 'Vadodara', deviceTypes: [DeviceType.GEYSER] });

      expect(res.status).toBe(201);
      const rows = await prisma.providerSignupRequest.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ city: 'Vadodara', deviceTypes: [DeviceType.GEYSER] });
    });

    it('409s for a number already registered as a provider', async () => {
      await prisma.user.create({ data: { phoneNo: PHONE, role: Role.PROVIDER, firstName: 'A', lastName: 'B' } });

      const res = await testRequest(app).post('/api/provider-signup').send(validBody);

      expect(res.status).toBe(409);
      expect(await prisma.providerSignupRequest.count()).toBe(0);
    });
  });

  describe('GET /api/provider-signup (admin)', () => {
    it('lists requests for an admin, filtered by status', async () => {
      await testRequest(app).post('/api/provider-signup').send(validBody);

      const all = await testRequest(app).get('/api/provider-signup').set('Authorization', `Bearer ${adminToken()}`);
      expect(all.status).toBe(200);
      expect(all.body.data.requests).toHaveLength(1);

      const rejected = await testRequest(app)
        .get('/api/provider-signup?status=REJECTED')
        .set('Authorization', `Bearer ${adminToken()}`);
      expect(rejected.body.data.requests).toHaveLength(0);
    });

    it('is not available without auth or to non-admins', async () => {
      const anon = await testRequest(app).get('/api/provider-signup');
      expect(anon.status).toBe(401);

      const customer = signAccessToken({ id: 'c1', phoneNo: '9000000000', role: Role.CUSTOMER });
      const res = await testRequest(app).get('/api/provider-signup').set('Authorization', `Bearer ${customer}`);
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/provider-signup/:id (admin)', () => {
    it('rejects a request and stamps reviewedAt', async () => {
      const created = await testRequest(app).post('/api/provider-signup').send(validBody);
      const id = created.body.data.request.id as string;

      const res = await testRequest(app)
        .patch(`/api/provider-signup/${id}`)
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ status: ProviderSignupStatus.REJECTED, adminNotes: 'Outside service area' });

      expect(res.status).toBe(200);
      const row = await prisma.providerSignupRequest.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe(ProviderSignupStatus.REJECTED);
      expect(row.adminNotes).toBe('Outside service area');
      expect(row.reviewedAt).not.toBeNull();
    });
  });

  describe('creating the provider', () => {
    it('marks the pending request APPROVED and links the new provider', async () => {
      const created = await testRequest(app).post('/api/provider-signup').send(validBody);
      const id = created.body.data.request.id as string;

      const provider = await testRequest(app)
        .post('/api/user/providers')
        .set('Authorization', `Bearer ${adminToken()}`)
        .send({ firstName: 'Ravi', lastName: 'Patel', phoneNo: PHONE, deviceTypes: [DeviceType.AIR_CONDITIONER] });
      expect(provider.status).toBe(201);

      const row = await prisma.providerSignupRequest.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe(ProviderSignupStatus.APPROVED);
      expect(row.providerId).toBe(provider.body.data.provider.id);
      expect(row.reviewedAt).not.toBeNull();
    });
  });
});
