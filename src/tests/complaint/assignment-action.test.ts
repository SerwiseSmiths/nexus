import prisma from '@/services/prisma.service';
import { Role } from '@prisma/client';
import { ComplaintService } from '@/services/complaint.service';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetComplaintTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser, createAddressFor, createComplaintFor } from './fixtures';

jest.mock('@/services/realtime.service', () => ({
  RealtimeService: {
    emitProviderAssigned: jest.fn().mockResolvedValue(undefined),
    emitProviderAccepted: jest.fn().mockResolvedValue(undefined),
    emitProviderRejected: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('@/services/notification.service', () => ({
  NotificationService: { sendToUser: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('@/services/telegram.service', () => ({
  TelegramService: {
    notifyNoProviderMatch: jest.fn().mockResolvedValue(undefined),
    notifyComplaintCreated: jest.fn().mockResolvedValue(undefined),
    notifyComplaintUpdated: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('Assignment actions from the native popup', () => {
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

  const setup = async () => {
    const customer = await createUser(Role.CUSTOMER);
    const provider = await createUser(Role.PROVIDER);
    const address = await createAddressFor(customer.id);
    const complaint = await createComplaintFor(customer.id, address.id, { providerId: provider.id });
    return { customer, provider, complaint };
  };

  const respond = (complaintId: string, body: Record<string, unknown>) =>
    testRequest(app).post(`/api/complaint/${complaintId}/assignment-action`).send(body);

  it('accepts with a valid token and no session', async () => {
    const { provider, complaint } = await setup();
    const token = ComplaintService.issueAssignmentActionToken(complaint.id, provider.id);

    const res = await respond(complaint.id, { token, action: 'accept' });

    expect(res.status).toBe(200);
    const after = await prisma.complaint.findUniqueOrThrow({ where: { id: complaint.id } });
    expect(after.providerAccepted).toBe(true);
  });

  it('rejects with a valid token — unassigns and records the rejection', async () => {
    const { provider, complaint } = await setup();
    const token = ComplaintService.issueAssignmentActionToken(complaint.id, provider.id);

    const res = await respond(complaint.id, { token, action: 'reject' });

    expect(res.status).toBe(200);
    const after = await prisma.complaint.findUniqueOrThrow({ where: { id: complaint.id } });
    expect(after.rejectedProviderIds).toContain(provider.id);
  });

  it('refuses a token issued for a different complaint', async () => {
    const { provider, complaint } = await setup();
    const other = await setup();
    const token = ComplaintService.issueAssignmentActionToken(other.complaint.id, provider.id);

    const res = await respond(complaint.id, { token, action: 'accept' });

    expect(res.status).toBe(401);
  });

  it('refuses once the job was reassigned to someone else', async () => {
    const { provider, complaint } = await setup();
    const token = ComplaintService.issueAssignmentActionToken(complaint.id, provider.id);
    const someoneElse = await createUser(Role.PROVIDER);
    await prisma.complaint.update({ where: { id: complaint.id }, data: { providerId: someoneElse.id } });

    const res = await respond(complaint.id, { token, action: 'accept' });

    expect(res.status).toBe(409);
  });

  it('refuses a replay after the job was already accepted (cannot flip to reject)', async () => {
    const { provider, complaint } = await setup();
    const token = ComplaintService.issueAssignmentActionToken(complaint.id, provider.id);
    await respond(complaint.id, { token, action: 'accept' });

    const res = await respond(complaint.id, { token, action: 'reject' });

    expect(res.status).toBe(409);
  });

  it('refuses a garbage token and a bad action', async () => {
    const { complaint } = await setup();
    expect((await respond(complaint.id, { token: 'not-a-jwt', action: 'accept' })).status).toBe(401);
    expect((await respond(complaint.id, { token: 'x', action: 'maybe' })).status).toBe(400);
  });

  it('cannot be used as a bearer access token', async () => {
    const { provider, complaint } = await setup();
    const token = ComplaintService.issueAssignmentActionToken(complaint.id, provider.id);

    const res = await testRequest(app)
      .get('/api/complaint/assigned')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });

  it('GET /:id/assignment-action-token issues a token only to the assigned provider', async () => {
    const { provider, complaint } = await setup();
    const stranger = await createUser(Role.PROVIDER);

    const ok = await testRequest(app)
      .get(`/api/complaint/${complaint.id}/assignment-action-token`)
      .set('Authorization', `Bearer ${signAccessToken(provider)}`);
    expect(ok.status).toBe(200);
    expect(typeof ok.body.data.actionToken).toBe('string');

    const denied = await testRequest(app)
      .get(`/api/complaint/${complaint.id}/assignment-action-token`)
      .set('Authorization', `Bearer ${signAccessToken(stranger)}`);
    expect(denied.status).toBe(404);
  });
});
