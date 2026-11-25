import prisma from '@/services/prisma.service';
import { NotificationEventType, NotificationType, Role } from '@prisma/client';
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

describe('Notification event tracking', () => {
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
    const notification = await prisma.notification.create({
      data: {
        userId:      provider.id,
        complaintId: complaint.id,
        title:       'New Job Assigned',
        body:        'x',
        type:        NotificationType.COMPLAINT,
        status:      'SENT',
        metadata:    { event: 'complaint_assigned', actionToken: 'secret' },
      },
    });
    return { customer, provider, complaint, notification };
  };

  it('records session-reported events once per step per notification', async () => {
    const { provider, notification } = await setup();
    const send = () =>
      testRequest(app)
        .post('/api/notification-events')
        .set('Authorization', `Bearer ${signAccessToken(provider)}`)
        .send({
          events: [
            { notificationId: notification.id, event: 'DELIVERED', source: 'APP' },
            { notificationId: notification.id, event: 'OPENED', source: 'APP', meta: { cta: 'view' } },
          ],
        });

    const first = await send();
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ recorded: 2, skipped: 0 });

    const second = await send();
    expect(second.body.data).toEqual({ recorded: 0, skipped: 2 });
  });

  it('matches a complaint-only (socket path) event to the assignment push', async () => {
    const { provider, complaint, notification } = await setup();
    await testRequest(app)
      .post('/api/notification-events')
      .set('Authorization', `Bearer ${signAccessToken(provider)}`)
      .send({ events: [{ complaintId: complaint.id, event: 'DISPLAYED', source: 'NATIVE' }] });

    const rows = await prisma.notificationEvent.findMany({ where: { complaintId: complaint.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].notificationId).toBe(notification.id);
  });

  it("ignores another user's notification", async () => {
    const { notification } = await setup();
    const stranger = await createUser(Role.PROVIDER);
    const res = await testRequest(app)
      .post('/api/notification-events')
      .set('Authorization', `Bearer ${signAccessToken(stranger)}`)
      .send({ events: [{ notificationId: notification.id, event: 'OPENED', source: 'APP' }] });
    expect(res.body.data).toEqual({ recorded: 0, skipped: 1 });
  });

  it('accepts native reports with the action token, scoped to its complaint', async () => {
    const { provider, complaint, notification } = await setup();
    const other = await setup();
    const token = ComplaintService.issueAssignmentActionToken(complaint.id, provider.id);

    const res = await testRequest(app)
      .post('/api/notification-events/token')
      .send({
        token,
        events: [
          { notificationId: notification.id, event: 'DELIVERED', source: 'NATIVE' },
          { complaintId: other.complaint.id, event: 'DELIVERED', source: 'NATIVE' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ recorded: 1, skipped: 1 });

    const bad = await testRequest(app)
      .post('/api/notification-events/token')
      .send({ token: 'nope', events: [{ complaintId: complaint.id, event: 'DELIVERED', source: 'NATIVE' }] });
    expect(bad.status).toBe(401);
  });

  it('refuses client-reported ACCEPTED — nexus records it from the accept endpoint', async () => {
    const { provider, complaint, notification } = await setup();
    const auth = `Bearer ${signAccessToken(provider)}`;

    const spoof = await testRequest(app)
      .post('/api/notification-events')
      .set('Authorization', auth)
      .send({ events: [{ notificationId: notification.id, event: 'ACCEPTED', source: 'APP' }] });
    expect(spoof.status).toBe(400);

    await testRequest(app)
      .patch(`/api/complaint/${complaint.id}/accept`)
      .set('Authorization', auth)
      .send({ surface: 'popup' });

    const accepted = await prisma.notificationEvent.findFirst({
      where: { notificationId: notification.id, event: NotificationEventType.ACCEPTED },
    });
    expect(accepted?.source).toBe('SERVER');
    expect(accepted?.meta).toEqual({ cta: 'popup' });
  });

  it('admin list returns the funnel, outcome filter and hides the action token', async () => {
    const { provider, notification } = await setup();
    await prisma.notificationEvent.create({
      data: {
        notificationId: notification.id, userId: provider.id, complaintId: notification.complaintId,
        event: 'OPENED', source: 'APP', occurredAt: new Date(),
      },
    });
    const admin = await createUser(Role.ADMIN);
    const auth = `Bearer ${signAccessToken(admin)}`;

    const res = await testRequest(app)
      .get('/api/notification-events/admin/notifications?outcome=opened_no_action')
      .set('Authorization', auth);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.notifications[0].metadata).toEqual({ event: 'complaint_assigned' });
    expect(res.body.data.notifications[0].events).toHaveLength(1);
    expect(res.body.data.stats.opened).toBe(1);

    const none = await testRequest(app)
      .get('/api/notification-events/admin/notifications?outcome=accepted')
      .set('Authorization', auth);
    expect(none.body.data.total).toBe(0);

    const denied = await testRequest(app)
      .get('/api/notification-events/admin/notifications')
      .set('Authorization', `Bearer ${signAccessToken(provider)}`);
    expect(denied.status).toBe(403);
  });
});
