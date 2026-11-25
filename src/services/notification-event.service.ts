import {
  NotificationEventSource,
  NotificationEventType,
  NotificationStatus,
  Prisma,
} from '@prisma/client';
import prisma from '@/services/prisma.service';
import { logger } from '@/utils/logger';
import type {
  AdminEventQuery,
  AdminNotificationQuery,
  ClientEventBody,
  NotificationOutcome,
  RecordServerEventInput,
  ReportEventsInput,
} from '@/types/notification-event.types';

// A push's events are matched to the assignment notification sent within
// this window before the event (socket-delivered alerts carry no notificationId).
const MATCH_WINDOW_BEFORE_MS = 30 * 60_000;
const MATCH_WINDOW_AFTER_MS  = 2 * 60_000;
// Device clocks drift and offline queues replay late — anything further in
// the future than this, or older than MAX_EVENT_AGE_MS, is recorded at "now".
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_EVENT_AGE_MS  = 7 * 24 * 60 * 60_000;

// Fields of Notification.metadata that must never leave nexus (the action
// token can accept/reject a job for 15 minutes).
const PRIVATE_METADATA_KEYS = ['actionToken'];

const USER_SELECT = { id: true, firstName: true, lastName: true, phoneNo: true, role: true } as const;

const ACTED_EVENTS: NotificationEventType[] = [NotificationEventType.ACCEPTED, NotificationEventType.REJECTED];
const OPENED_OR_ACTED: NotificationEventType[] = [NotificationEventType.OPENED, ...ACTED_EVENTS];

function clampOccurredAt(raw: number | string | undefined): Date {
  const now = Date.now();
  if (raw === undefined) return new Date(now);
  const ms = typeof raw === 'number' ? raw : Date.parse(raw);
  if (!Number.isFinite(ms) || ms > now + MAX_CLOCK_SKEW_MS || ms < now - MAX_EVENT_AGE_MS) {
    return new Date(now);
  }
  return new Date(ms);
}

function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  const gte = from ? new Date(from) : undefined;
  const lte = to ? new Date(`${to}T23:59:59.999Z`) : undefined;
  if ((!gte || isNaN(gte.getTime())) && (!lte || isNaN(lte.getTime()))) return undefined;
  return {
    ...(gte && !isNaN(gte.getTime()) && { gte }),
    ...(lte && !isNaN(lte.getTime()) && { lte }),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function stripPrivateMetadata(metadata: Prisma.JsonValue): Prisma.JsonValue {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata;
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !PRIVATE_METADATA_KEYS.includes(key)),
  );
}

export class NotificationEventService {
  // ─── Ingestion ─────────────────────────────────────────────────────────────

  // Reports from the radix app (session) or its native code (action token).
  // Best-effort by design: an event that can't be attributed is dropped, never
  // an error for the whole batch — the device must not retry forever.
  static async reportEvents({ userId, events, tokenComplaintId }: ReportEventsInput) {
    let recorded = 0;
    let skipped  = 0;

    for (const e of events) {
      const ok = await NotificationEventService.recordOne(userId, e, tokenComplaintId).catch((err) => {
        logger.warn('[NotificationEvent] Failed to record event', { userId, event: e.event, err });
        return false;
      });
      if (ok) recorded += 1;
      else skipped += 1;
    }

    return { recorded, skipped };
  }

  private static async recordOne(
    userId: string,
    e: ClientEventBody,
    tokenComplaintId?: string,
  ): Promise<boolean> {
    // The action token is scoped to one complaint — events for anything else are ignored.
    if (tokenComplaintId && e.complaintId && e.complaintId !== tokenComplaintId) return false;
    const occurredAt = clampOccurredAt(e.occurredAt);

    let notificationId: string | null = null;
    let complaintId: string | null = e.complaintId ?? tokenComplaintId ?? null;

    if (e.notificationId) {
      const notification = await prisma.notification.findFirst({
        where:  { id: e.notificationId, userId, isDeleted: false },
        select: { id: true, complaintId: true },
      });
      if (!notification) return false;
      if (tokenComplaintId && notification.complaintId !== tokenComplaintId) return false;
      notificationId = notification.id;
      complaintId = notification.complaintId ?? complaintId;
    } else if (complaintId) {
      if (!(await NotificationEventService.canReportForComplaint(userId, complaintId))) return false;
      notificationId = await NotificationEventService.matchAssignmentNotification(userId, complaintId, occurredAt);
    }

    return NotificationEventService.insert({
      notificationId,
      userId,
      complaintId,
      event:      e.event,
      source:     e.source as NotificationEventSource,
      meta:       e.meta,
      occurredAt,
    });
  }

  // Written from ComplaintService.acceptAssignment / rejectAssignment — the
  // authoritative "clicked a CTA" outcome, independent of any device report.
  // Awaited inline by the caller but never throws: tracking must not fail an accept.
  static async recordServerEvent({ userId, complaintId, event, meta }: RecordServerEventInput): Promise<void> {
    try {
      const occurredAt = new Date();
      const notificationId = await NotificationEventService.matchAssignmentNotification(userId, complaintId, occurredAt);
      await NotificationEventService.insert({
        notificationId,
        userId,
        complaintId,
        event,
        source: NotificationEventSource.SERVER,
        meta,
        occurredAt,
      });
    } catch (err) {
      logger.error('[NotificationEvent] Failed to record server event', { userId, complaintId, event, err });
    }
  }

  // The provider can only report on a job that is, or was, offered to them.
  private static async canReportForComplaint(userId: string, complaintId: string): Promise<boolean> {
    const complaint = await prisma.complaint.findFirst({
      where: {
        id: complaintId,
        isDeleted: false,
        OR: [
          { providerId: userId },
          { userId },
          { rejectedProviderIds: { has: userId } },
          { notifications: { some: { userId } } },
        ],
      },
      select: { id: true },
    });
    return !!complaint;
  }

  // Latest job-assignment push for this provider + complaint sent shortly
  // before the event. Null when there was none (e.g. an out-of-hours
  // assignment delivered only through the app's pending-assignment check).
  private static async matchAssignmentNotification(
    userId: string,
    complaintId: string,
    occurredAt: Date,
  ): Promise<string | null> {
    // The phone's clock may lag behind nexus's — never look before the window,
    // but always allow up to "now" so a late-clock device still matches.
    const upper = new Date(Math.max(occurredAt.getTime() + MATCH_WINDOW_AFTER_MS, Date.now()));
    const notification = await prisma.notification.findFirst({
      where: {
        userId,
        complaintId,
        isDeleted: false,
        metadata:  { path: ['event'], equals: 'complaint_assigned' },
        createdAt: { gte: new Date(occurredAt.getTime() - MATCH_WINDOW_BEFORE_MS), lte: upper },
      },
      orderBy: { createdAt: 'desc' },
      select:  { id: true },
    });
    return notification?.id ?? null;
  }

  private static async insert(data: {
    notificationId: string | null;
    userId:         string;
    complaintId:    string | null;
    event:          NotificationEventType;
    source:         NotificationEventSource;
    meta?:          Record<string, string | number | boolean>;
    occurredAt:     Date;
  }): Promise<boolean> {
    // Unlinked events have no unique key (NULL notificationId) — dedupe the
    // same step for the same job within the match window by hand.
    if (!data.notificationId) {
      const existing = await prisma.notificationEvent.findFirst({
        where: {
          notificationId: null,
          userId:         data.userId,
          complaintId:    data.complaintId,
          event:          data.event,
          occurredAt: {
            gte: new Date(data.occurredAt.getTime() - MATCH_WINDOW_BEFORE_MS),
            lte: new Date(data.occurredAt.getTime() + MATCH_WINDOW_BEFORE_MS),
          },
        },
        select: { id: true },
      });
      if (existing) return false;
    }

    try {
      await prisma.notificationEvent.create({
        data: {
          notificationId: data.notificationId,
          userId:         data.userId,
          complaintId:    data.complaintId,
          event:          data.event,
          source:         data.source,
          meta:           data.meta ?? Prisma.JsonNull,
          occurredAt:     data.occurredAt,
        },
      });
      return true;
    } catch (err) {
      // Same step already reported for this push (native + JS + socket all
      // fire for one job) — first report wins.
      if (isUniqueViolation(err)) return false;
      throw err;
    }
  }

  // ─── Admin (watchtower) ────────────────────────────────────────────────────

  private static outcomeWhere(outcome: NotificationOutcome): Prisma.NotificationWhereInput {
    const has  = (event: NotificationEventType): Prisma.NotificationWhereInput =>
      ({ events: { some: { event, isDeleted: false } } });
    switch (outcome) {
      case 'failed':
        return { status: NotificationStatus.FAILED };
      case 'no_report':
        return { status: NotificationStatus.SENT, events: { none: { isDeleted: false } } };
      case 'delivered_not_opened':
        return {
          events: {
            some: { event: { in: [NotificationEventType.DELIVERED, NotificationEventType.DISPLAYED] }, isDeleted: false },
            none: { event: { in: OPENED_OR_ACTED }, isDeleted: false },
          },
        };
      case 'opened_no_action':
        return {
          AND: [
            has(NotificationEventType.OPENED),
            { events: { none: { event: { in: ACTED_EVENTS }, isDeleted: false } } },
          ],
        };
      case 'accepted':  return has(NotificationEventType.ACCEPTED);
      case 'rejected':  return has(NotificationEventType.REJECTED);
      case 'dismissed': return has(NotificationEventType.DISMISSED);
      case 'timed_out': return has(NotificationEventType.TIMED_OUT);
    }
  }

  private static notificationWhere(q: Omit<AdminNotificationQuery, 'outcome' | 'page' | 'limit'>): Prisma.NotificationWhereInput {
    const createdAt = dateRange(q.from, q.to);
    const search = q.search;
    return {
      isDeleted: false,
      ...(q.userId && { userId: q.userId }),
      ...(q.complaintId && { complaintId: q.complaintId }),
      ...(q.role && { user: { role: q.role } }),
      ...(q.type && { type: q.type }),
      ...(q.status && { status: q.status }),
      ...(q.trackedOnly === 'true' && { events: { some: { isDeleted: false } } }),
      ...(createdAt && { createdAt }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { body: { contains: search, mode: 'insensitive' } },
          { id: search },
          { complaintId: { endsWith: search, mode: 'insensitive' } },
          { complaint: { title: { contains: search, mode: 'insensitive' } } },
          { user: { firstName: { contains: search, mode: 'insensitive' } } },
          { user: { lastName: { contains: search, mode: 'insensitive' } } },
          { user: { phoneNo: { contains: search } } },
        ],
      }),
    };
  }

  // Notifications with their full event funnel, plus funnel counts over the
  // whole filtered set (not just the current page).
  static async listNotifications(q: AdminNotificationQuery) {
    const base  = NotificationEventService.notificationWhere(q);
    const where: Prisma.NotificationWhereInput = q.outcome
      ? { AND: [base, NotificationEventService.outcomeWhere(q.outcome)] }
      : base;

    const countWith = (outcome: NotificationOutcome) =>
      prisma.notification.count({ where: { AND: [base, NotificationEventService.outcomeWhere(outcome)] } });
    const countHas = (event: NotificationEventType) =>
      prisma.notification.count({ where: { AND: [base, { events: { some: { event, isDeleted: false } } }] } });

    const [rows, total, sent, failed, delivered, displayed, opened, accepted, rejected, dismissed, timedOut, noReport] =
      await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip:    (q.page - 1) * q.limit,
          take:    q.limit,
          include: {
            user:      { select: USER_SELECT },
            complaint: { select: { id: true, title: true, stage: true } },
            events:    { where: { isDeleted: false }, orderBy: { occurredAt: 'asc' } },
          },
        }),
        prisma.notification.count({ where }),
        prisma.notification.count({ where: { AND: [base, { status: NotificationStatus.SENT }] } }),
        countWith('failed'),
        countHas(NotificationEventType.DELIVERED),
        countHas(NotificationEventType.DISPLAYED),
        countHas(NotificationEventType.OPENED),
        countHas(NotificationEventType.ACCEPTED),
        countHas(NotificationEventType.REJECTED),
        countHas(NotificationEventType.DISMISSED),
        countHas(NotificationEventType.TIMED_OUT),
        countWith('no_report'),
      ]);

    return {
      notifications: rows.map((n) => ({ ...n, metadata: stripPrivateMetadata(n.metadata) })),
      total,
      page:  q.page,
      limit: q.limit,
      stats: { sent, failed, delivered, displayed, opened, accepted, rejected, dismissed, timedOut, noReport },
    };
  }

  // Raw event log, including events never matched to a push.
  static async listEvents(q: AdminEventQuery) {
    const occurredAt = dateRange(q.from, q.to);
    const search = q.search;
    const where: Prisma.NotificationEventWhereInput = {
      isDeleted: false,
      ...(q.userId && { userId: q.userId }),
      ...(q.complaintId && { complaintId: q.complaintId }),
      ...(q.notificationId && { notificationId: q.notificationId }),
      ...(q.event && { event: q.event }),
      ...(q.source && { source: q.source }),
      ...(q.unlinkedOnly === 'true' && { notificationId: null }),
      ...(occurredAt && { occurredAt }),
      ...(search && {
        OR: [
          { complaintId: { endsWith: search, mode: 'insensitive' } },
          { complaint: { title: { contains: search, mode: 'insensitive' } } },
          { notification: { title: { contains: search, mode: 'insensitive' } } },
          { user: { firstName: { contains: search, mode: 'insensitive' } } },
          { user: { lastName: { contains: search, mode: 'insensitive' } } },
          { user: { phoneNo: { contains: search } } },
        ],
      }),
    };

    const [events, total] = await Promise.all([
      prisma.notificationEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip:    (q.page - 1) * q.limit,
        take:    q.limit,
        include: {
          user:         { select: USER_SELECT },
          complaint:    { select: { id: true, title: true } },
          notification: { select: { id: true, title: true, type: true, status: true, createdAt: true } },
        },
      }),
      prisma.notificationEvent.count({ where }),
    ]);

    return { events, total, page: q.page, limit: q.limit };
  }
}
