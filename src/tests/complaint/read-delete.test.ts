import prisma from '@/services/prisma.service';
import { Role } from '@prisma/client';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetComplaintTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser, createAddressFor, createComplaintFor } from './fixtures';

describe('Complaint read + delete', () => {
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

  describe('GET /api/complaint/:id', () => {
    it('the owning customer can view it', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id);
      const token = signAccessToken(customer);

      const res = await testRequest(app).get(`/api/complaint/${complaint.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('the assigned provider can view it', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
      const token = signAccessToken(provider);

      const res = await testRequest(app).get(`/api/complaint/${complaint.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('ADMIN can view any complaint', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const admin = await createUser(Role.ADMIN);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id);
      const token = signAccessToken(admin);

      const res = await testRequest(app).get(`/api/complaint/${complaint.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('rejects an unrelated customer with 404 (standardized 2026-09-12 — was 403)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const other = await createUser(Role.CUSTOMER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id);
      const token = signAccessToken(other);

      const res = await testRequest(app).get(`/api/complaint/${complaint.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('rejects an unrelated provider with 404 (standardized 2026-09-12 — was 403)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const assignedProvider = await createUser(Role.PROVIDER);
      const unrelatedProvider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { providerId: assignedProvider.id });
      const token = signAccessToken(unrelatedProvider);

      const res = await testRequest(app).get(`/api/complaint/${complaint.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('returns 404 for a nonexistent id', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const token = signAccessToken(customer);

      const res = await testRequest(app)
        .get('/api/complaint/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/complaint/my, /assigned, / (admin)', () => {
    it('myComplaints only returns the caller\'s own complaints', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const other = await createUser(Role.CUSTOMER);
      const address = await createAddressFor(customer.id);
      const otherAddress = await createAddressFor(other.id);
      await createComplaintFor(customer.id, address.id);
      await createComplaintFor(other.id, otherAddress.id);
      const token = signAccessToken(customer);

      const res = await testRequest(app).get('/api/complaint/my').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.complaints).toHaveLength(1);
    });

    it('assignedComplaints only returns complaints assigned to the caller', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const provider = await createUser(Role.PROVIDER);
      const otherProvider = await createUser(Role.PROVIDER);
      const address = await createAddressFor(customer.id);
      await createComplaintFor(customer.id, address.id, { providerId: provider.id });
      await createComplaintFor(customer.id, address.id, { providerId: otherProvider.id });
      const token = signAccessToken(provider);

      const res = await testRequest(app).get('/api/complaint/assigned').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.complaints).toHaveLength(1);
    });

    it('GET / (admin) lists every complaint regardless of owner', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const other = await createUser(Role.CUSTOMER);
      const admin = await createUser(Role.ADMIN);
      const address = await createAddressFor(customer.id);
      const otherAddress = await createAddressFor(other.id);
      await createComplaintFor(customer.id, address.id);
      await createComplaintFor(other.id, otherAddress.id);
      const token = signAccessToken(admin);

      const res = await testRequest(app).get('/api/complaint').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.complaints).toHaveLength(2);
    });

    it('rejects a CUSTOMER calling GET / (admin-only) with 403', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const token = signAccessToken(customer);

      const res = await testRequest(app).get('/api/complaint').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/complaint/:id', () => {
    it('the owner can delete their own ENTRANCE-stage complaint', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id);
      const token = signAccessToken(customer);

      const res = await testRequest(app).delete(`/api/complaint/${complaint.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);

      const row = await prisma.complaint.findUnique({ where: { id: complaint.id } });
      expect(row?.isDeleted).toBe(true);
    });

    it('a non-admin owner cannot delete an active (non-ENTRANCE/REJECTED) complaint: 400', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { stage: 'ESTIMATION' });
      const token = signAccessToken(customer);

      const res = await testRequest(app).delete(`/api/complaint/${complaint.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('ADMIN can delete a complaint in any stage', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const admin = await createUser(Role.ADMIN);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id, { stage: 'ESTIMATION' });
      const token = signAccessToken(admin);

      const res = await testRequest(app).delete(`/api/complaint/${complaint.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
    });

    it('rejects a non-owner, non-admin with 404 (standardized 2026-09-12 — was 403)', async () => {
      const customer = await createUser(Role.CUSTOMER);
      const other = await createUser(Role.CUSTOMER);
      const address = await createAddressFor(customer.id);
      const complaint = await createComplaintFor(customer.id, address.id);
      const token = signAccessToken(other);

      const res = await testRequest(app).delete(`/api/complaint/${complaint.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });
});
