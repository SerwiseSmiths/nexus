import { ComplaintStage, NotificationType, PaymentProvider, Prisma, QuoteStatus, Role, WorkHistoryEvent } from '@prisma/client';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '@/configs';
import prisma from '@/services/prisma.service';
import { ApiError } from '@/utils/apiResponse';
import { logger } from '@/utils/logger';
import { describeZodError } from '@/utils/zodError';
import { RealtimeService } from '@/services/realtime.service';
import { NotificationService } from '@/services/notification.service';
import { TelegramService } from '@/services/telegram.service';
import { WalletService } from '@/services/wallet.service';
import { StrapiService } from '@/services/strapi.service';
import { DeviceTypeGroupService } from '@/services/device-type-group.service';
import { DEVICE_KEY_TO_TYPE, DEVICE_META_VALIDATORS, type DeviceKey } from '@/types/device.types';
import type {
  CreateComplaintInput,
  UpdateStageInput,
  AssignProviderInput,
  AddQuoteInput,
  RespondToQuoteInput,
  LinkDeviceInput,
  ValidateQrInput,
  ReopenComplaintInput,
  CompletePaymentInput,
  RequestedDevice,
} from '@/types/complaint.types';

// ---------------------------------------------------------------------------
// Shared include — used across all queries for consistent shape
// ---------------------------------------------------------------------------

const COMPLAINT_INCLUDE = {
  user: {
    select: { id: true, firstName: true, lastName: true, phoneNo: true, email: true, avatar: true },
  },
  provider: {
    select: { id: true, firstName: true, lastName: true, phoneNo: true, email: true, avatar: true },
  },
  address: true,
  // External consumers reference a group by its stable `key`, never by the
  // internal DB `id` — omitted here so nothing downstream is tempted to use it.
  group: { select: { key: true, name: true, deviceTypes: true } },
  // Physical devices identified so far (may be empty right after creation —
  // see requestedDevices for what was originally asked for before any
  // provider identified real units on-site).
  devices: {
    include: {
      device: { select: { id: true, type: true, deviceKey: true, imageUrl: true, metadata: true } },
    },
  },
  media: {
    where:   { isDeleted: false },
    orderBy: { createdAt: 'asc' as const },
  },
  quote: true,
  // Dated timeline of every stage change / assignment / quote event — see
  // ComplaintService.logComplaintEvent.
  logs: {
    where:   { isDeleted: false },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.ComplaintInclude;

type ComplaintWithRelations = Prisma.ComplaintGetPayload<{ include: typeof COMPLAINT_INCLUDE }>;

// ---------------------------------------------------------------------------
// Stage transition rules
// ---------------------------------------------------------------------------

const STAGE_TRANSITIONS: Record<ComplaintStage, ComplaintStage[]> = {
  [ComplaintStage.ENTRANCE]:     [ComplaintStage.QR_VALIDATED, ComplaintStage.REJECTED],
  [ComplaintStage.QR_VALIDATED]: [ComplaintStage.ESTIMATION, ComplaintStage.REJECTED],
  [ComplaintStage.ESTIMATION]:   [ComplaintStage.APPROVAL, ComplaintStage.REJECTED],
  [ComplaintStage.APPROVAL]:     [ComplaintStage.IN_PROGRESS, ComplaintStage.REJECTED],
  [ComplaintStage.IN_PROGRESS]:  [ComplaintStage.PAYMENT, ComplaintStage.REJECTED],
  [ComplaintStage.PAYMENT]:      [ComplaintStage.COMPLETED, ComplaintStage.REJECTED],
  [ComplaintStage.COMPLETED]:    [],
  [ComplaintStage.REJECTED]:     [],
};

// ---------------------------------------------------------------------------
// Customer-facing notification copy per stage
// ---------------------------------------------------------------------------

const STAGE_NOTIFICATIONS: Partial<Record<ComplaintStage, { title: string; body: string }>> = {
  [ComplaintStage.QR_VALIDATED]: {
    title: 'Provider Arrived',
    body:  'Your provider has arrived and verified their presence on-site.',
  },
  [ComplaintStage.ESTIMATION]: {
    title: 'Assessment Started',
    body:  'Your provider is assessing the issue.',
  },
  [ComplaintStage.APPROVAL]: {
    title: 'Quote Ready for Review',
    body:  'Your provider submitted a quote. Please review and approve.',
  },
  [ComplaintStage.IN_PROGRESS]: {
    title: 'Repair Started',
    body:  'Your provider has started repairing your device.',
  },
  [ComplaintStage.PAYMENT]: {
    title: 'Payment Required',
    body:  'Please complete your payment to proceed with the service.',
  },
  [ComplaintStage.COMPLETED]: {
    title: 'Service Completed',
    body:  'Your service has been completed successfully. Thank you!',
  },
  [ComplaintStage.REJECTED]: {
    title: 'Complaint Rejected',
    body:  'Your complaint has been rejected. Please contact support if needed.',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const QR_EXPIRY_MINUTES = 10;

function generateQrExpiry(): Date {
  const d = new Date();
  d.setMinutes(d.getMinutes() + QR_EXPIRY_MINUTES);
  return d;
}

// ---------------------------------------------------------------------------
// Job-assignment business hours (9am-6pm IST) — the full-screen "New Job"
// popup is only shown to a provider inside this window. IST has a fixed
// UTC+5:30 offset (no DST), so shifting by a constant ms value and reading
// the UTC getters back off the shifted Date gives IST wall-clock components
// without needing Intl/timezone-database parsing.
//
// Enforced in PRODUCTION only — dev/local/test environments allow the
// popup at any time so testing (and demoing) isn't gated by the clock.
// ---------------------------------------------------------------------------

const BUSINESS_HOURS_START = 9;
const BUSINESS_HOURS_END = 18;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istParts(date: Date): { year: number; month: number; day: number; hour: number } {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year:  shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day:   shifted.getUTCDate(),
    hour:  shifted.getUTCHours(),
  };
}

function isWithinBusinessHours(date: Date = new Date()): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const { hour } = istParts(date);
  return hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END;
}

// Deadline for a provider to open the app and see a deferred assignment
// popup before it's handed to a different provider — end of the next
// calendar day's business window (IST), giving them a full day to check in.
function nextAssignmentDeadline(date: Date = new Date()): Date {
  const { year, month, day } = istParts(date);
  return new Date(Date.UTC(year, month, day + 1, BUSINESS_HOURS_END, 0) - IST_OFFSET_MS);
}

// `Promise.resolve().then(fn)` (not a bare `fn()`) so a synchronous throw
// inside fn — e.g. a partially-mocked service in tests — is caught here too
// instead of escaping and failing the request that triggered it.
// ---------------------------------------------------------------------------
// Job-assignment action tokens
//
// Lets radix's native floating job popup accept/reject straight from the
// phone's home screen — native Android code has no access to the JS-held
// session, so the assignment push carries this token instead. Signed with a
// secret *derived* from JWT_SECRET (never JWT_SECRET itself) so it can never
// be replayed as a bearer access token against the auth middleware, and it
// is scoped to one complaint + one provider for a short window.
// ---------------------------------------------------------------------------

const ASSIGNMENT_ACTION_PURPOSE = 'assignment-action';
const ASSIGNMENT_ACTION_EXPIRY = '15m';

function assignmentActionSecret(): jwt.Secret {
  return `${config.jwt.secret}:${ASSIGNMENT_ACTION_PURPOSE}`;
}

export type AssignmentAction = 'accept' | 'reject';

// Everything radix's native floating job card shows (mirrors the in-app
// NewJobPopup: job title, device pill, customer, address, call/location) —
// sent in the assignment push because native code can't fetch the complaint
// itself. FCM data values must be strings; empty ones are omitted.
function assignmentPushDetails(complaint: ComplaintWithRelations): Record<string, string> {
  const requested = Array.isArray(complaint.requestedDevices)
    ? (complaint.requestedDevices as unknown as RequestedDevice[])
    : [];
  const address = complaint.address;
  const details: Record<string, string> = {
    jobTitle:      complaint.title ?? '',
    deviceLabel:   requested[0]?.deviceKey ?? '',
    customerName:  `${complaint.user?.firstName ?? ''} ${complaint.user?.lastName ?? ''}`.trim(),
    customerPhone: complaint.user?.phoneNo ?? '',
    address:       address
      ? [address.houseNo, address.societyName, address.area, address.city].filter(Boolean).join(', ')
      : '',
  };
  return Object.fromEntries(Object.entries(details).filter(([, v]) => v));
}

function emit(fn: () => Promise<unknown>): void {
  Promise.resolve()
    .then(fn)
    .catch((err) => logger.error('[Complaint] Background task failed:', err));
}

// Writes one row to the complaint's audit timeline. Always awaited inline
// (never via `emit()`) — a log entry recording what happened is part of the
// state change itself, not a best-effort side effect that's fine to lose.
async function logComplaintEvent(params: {
  complaintId: string;
  event: string;
  fromStage?: ComplaintStage | null;
  toStage?: ComplaintStage | null;
  actorId?: string | null;
  actorRole?: Role | null;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.complaintLog.create({
      data: {
        complaintId: params.complaintId,
        event:       params.event,
        fromStage:   params.fromStage ?? null,
        toStage:     params.toStage ?? null,
        actorId:     params.actorId ?? null,
        actorRole:   params.actorRole ?? null,
        metadata:    params.metadata,
      },
    });
  } catch (err) {
    logger.error('[Complaint] Failed to write complaint log:', err, params);
  }
}

// A quote is treated as a filter change if any line item name mentions "filter" —
// there's no dedicated category field on quote items today, so this is a
// best-effort heuristic rather than an authoritative classification.
function isFilterRelatedQuote(items: unknown): boolean {
  if (!Array.isArray(items)) return false;
  return items.some(
    item => item && typeof (item as { name?: unknown }).name === 'string' &&
      /filter/i.test((item as { name: string }).name),
  );
}

// ---------------------------------------------------------------------------
// ComplaintService
// ---------------------------------------------------------------------------

export class ComplaintService {
  // ─── Create ───────────────────────────────────────────────────────────────

  // A request naming multiple device types/quantities is split by
  // DeviceTypeGroup — devices sharing a group bundle into ONE complaint
  // (serviced by a single provider), a different group becomes a separate
  // complaint. Actual Device rows don't need to exist yet; requestedDevices
  // records what was asked for until a provider identifies real units
  // on-site (see linkDevice).
  static async createComplaint({
    userId,
    title,
    notes,
    addressId,
    requestedDevices,
  }: CreateComplaintInput): Promise<ComplaintWithRelations[]> {
    const address = await prisma.address.findFirst({
      where: { id: addressId, userId, isDeleted: false },
    });
    if (!address) throw new ApiError(404, 'Address not found');

    // Resolve every requested device to its group up front — throw before
    // creating anything if any deviceKey is unknown (same all-or-nothing
    // principle as the old per-device-id validation).
    const byGroup = new Map<string, RequestedDevice[]>();
    for (const item of requestedDevices) {
      const deviceType = DEVICE_KEY_TO_TYPE[item.deviceKey as DeviceKey];
      if (!deviceType) throw new ApiError(400, `Unknown device key: ${item.deviceKey}`);

      const group = await DeviceTypeGroupService.findByDeviceType(deviceType);
      const existing = byGroup.get(group.id) ?? [];
      existing.push(item);
      byGroup.set(group.id, existing);
    }

    // All-or-nothing: every complaint in the batch commits together.
    const complaints = await prisma.$transaction(
      Array.from(byGroup.entries()).map(([groupId, items]) =>
        prisma.complaint.create({
          data: {
            userId,
            title,
            notes:     notes ?? null,
            addressId,
            groupId,
            requestedDevices: items as unknown as Prisma.InputJsonValue,
            stage:     ComplaintStage.ENTRANCE,
          },
          include: COMPLAINT_INCLUDE,
        }),
      ),
    );

    // Side effects only fire once the whole batch is durably committed.
    for (const complaint of complaints) {
      await logComplaintEvent({
        complaintId: complaint.id,
        event:       'CREATED',
        toStage:     ComplaintStage.ENTRANCE,
        actorId:     userId,
      });
      emit(() => RealtimeService.emitComplaintCreated(complaint as unknown as Record<string, unknown>));
      emit(() =>
        NotificationService.sendToUser({
          userId,
          title: 'Complaint Submitted',
          body:  `Your complaint "${title}" has been submitted. We're finding a provider.`,
          type:  NotificationType.COMPLAINT,
          complaintId: complaint.id,
        }),
      );
      emit(() => ComplaintService.autoAssignProvider(complaint.id, []));
      emit(() => TelegramService.notifyComplaintCreated(complaint));
    }

    return complaints;
  }

  // ─── Auto-assign ──────────────────────────────────────────────────────────

  static async autoAssignProvider(complaintId: string, excludeIds: string[]): Promise<void> {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, isDeleted: false },
      include: { group: true },
    });
    if (!complaint) {
      logger.warn('[Complaint] autoAssignProvider called for missing complaint', { complaintId });
      return;
    }

    // A provider is eligible only if their skillGroups cover this complaint's
    // entire device-type group. If the complaint has no group yet (shouldn't
    // normally happen — createComplaint always sets one), fall back to
    // matching any active provider rather than blocking assignment.
    const groupId = complaint.groupId;

    const providers = await prisma.user.findMany({
      where: {
        role:      Role.PROVIDER,
        isActive:  true,
        isDeleted: false,
        id: excludeIds.length > 0 ? { notIn: excludeIds } : undefined,
        ...(groupId && { providerProfile: { skillGroups: { some: { id: groupId } } } }),
      },
      include: {
        _count: {
          select: {
            complaintsAsProvider: {
              where: {
                stage:     { notIn: [ComplaintStage.COMPLETED, ComplaintStage.REJECTED] },
                isDeleted: false,
              },
            },
          },
        },
      },
    });

    if (providers.length === 0) {
      logger.warn('[Complaint] No skill-matching providers found for auto-assign', {
        complaintId, groupId, excludeIds,
      });
      // Leave the complaint unassigned rather than assigning a provider without
      // the matching skill — flag admins so they can assign one manually.
      emit(() => TelegramService.notifyNoProviderMatch(complaint, complaint.group?.name ?? null));
      return;
    }

    // Pick provider with fewest active complaints (basic load balancing)
    const best = providers.reduce((a, b) =>
      a._count.complaintsAsProvider <= b._count.complaintsAsProvider ? a : b,
    );

    logger.info('[Complaint] Auto-assigning provider', {
      complaintId, providerId: best.id, groupId, candidateCount: providers.length,
    });

    await ComplaintService.assignProvider({ complaintId, providerId: best.id });
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  static async listAll() {
    return prisma.complaint.findMany({
      where:   { isDeleted: false },
      include: COMPLAINT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  static async listByCustomer(userId: string) {
    return prisma.complaint.findMany({
      where:   { userId, isDeleted: false },
      include: COMPLAINT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  static async listByProvider(providerId: string) {
    return prisma.complaint.findMany({
      where:   { providerId, isDeleted: false },
      include: COMPLAINT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getById(complaintId: string, requesterId: string, requesterRole: Role) {
    const complaint = await prisma.complaint.findFirst({
      where:   { id: complaintId, isDeleted: false },
      include: COMPLAINT_INCLUDE,
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found');

    // 404, not 403 — standardized 2026-09-12 to match every other
    // "not yours" check in this file (non-leaking: doesn't confirm the
    // complaint exists to someone with no relationship to it).
    if (
      requesterRole !== Role.ADMIN &&
      complaint.userId !== requesterId &&
      complaint.providerId !== requesterId
    ) {
      throw new ApiError(404, 'Complaint not found');
    }

    return complaint;
  }

  // ─── Stage ────────────────────────────────────────────────────────────────

  static async updateStage({
    complaintId,
    stage,
    rejectionReason,
    updatedById,
    requesterRole,
  }: UpdateStageInput): Promise<ComplaintWithRelations> {
    // A PROVIDER may only transition a complaint they're actually assigned
    // to — previously this had no ownership check at all (unlike every other
    // provider-facing method in this file), so any authenticated provider
    // could change the stage of any complaint. ADMIN is unrestricted by design.
    const complaint = await prisma.complaint.findFirst({
      where: {
        id: complaintId,
        isDeleted: false,
        ...(requesterRole === Role.PROVIDER && { providerId: updatedById }),
      },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found or not assigned to you');

    const allowed = STAGE_TRANSITIONS[complaint.stage];
    if (!allowed.includes(stage)) {
      throw new ApiError(
        400,
        `Cannot transition from ${complaint.stage} to ${stage}. Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }

    const oldStage = complaint.stage;
    const updated = await prisma.complaint.update({
      where: { id: complaintId },
      data: {
        stage,
        ...(stage === ComplaintStage.REJECTED && {
          rejectionReason: rejectionReason ?? null,
          rejectedAt:      new Date(),
          rejectedBy:      updatedById,
        }),
      },
      include: COMPLAINT_INCLUDE,
    });

    await logComplaintEvent({
      complaintId,
      event: 'STAGE_CHANGED',
      fromStage: oldStage,
      toStage: stage,
      actorId: updatedById,
      actorRole: requesterRole,
      ...(stage === ComplaintStage.REJECTED && rejectionReason && { metadata: { rejectionReason } }),
    });

    emit(() =>
      RealtimeService.emitStageChanged(
        updated as unknown as Record<string, unknown>,
        oldStage,
        stage,
      ),
    );

    const notifCopy = STAGE_NOTIFICATIONS[stage];
    if (notifCopy) {
      emit(() =>
        NotificationService.sendToUser({
          userId:      complaint.userId,
          title:       notifCopy.title,
          body:        notifCopy.body,
          type:        NotificationType.COMPLAINT,
          complaintId,
        }),
      );
    }

    emit(() => TelegramService.notifyComplaintUpdated(updated, { stage: `${oldStage} → ${stage}` }));

    return updated;
  }

  // ─── Provider Assignment ──────────────────────────────────────────────────

  static async assignProvider({ complaintId, providerId, actorId, actorRole }: AssignProviderInput) {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, isDeleted: false },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found');

    if (complaint.stage === ComplaintStage.COMPLETED || complaint.stage === ComplaintStage.REJECTED) {
      throw new ApiError(400, 'Cannot assign provider to a closed complaint');
    }

    const provider = await prisma.user.findFirst({
      where: { id: providerId, role: Role.PROVIDER, isActive: true, isDeleted: false },
    });
    if (!provider) throw new ApiError(404, 'Provider not found');

    const now = new Date();
    const withinHours = isWithinBusinessHours(now);

    const updated = await prisma.complaint.update({
      where: { id: complaintId },
      data: {
        providerId,
        providerAccepted:   false,
        providerAcceptedAt: null,
        // Outside 9am-6pm IST, hold the job-assignment popup until the
        // provider next opens the app (claimPendingAssignment) instead of
        // alerting them immediately.
        assignmentPending:  !withinHours,
        assignmentDeadline: withinHours ? null : nextAssignmentDeadline(now),
      },
      include: COMPLAINT_INCLUDE,
    });

    await logComplaintEvent({
      complaintId,
      event: 'PROVIDER_ASSIGNED',
      actorId: actorId ?? null,
      actorRole: actorRole ?? null,
      metadata: { providerId, withinBusinessHours: withinHours },
    });

    emit(() =>
      RealtimeService.emitProviderAssigned(updated as unknown as Record<string, unknown>, withinHours),
    );
    // Reassigned away from someone else (admin reassign from watchtower) —
    // tell the previous provider so it drops off their list right away.
    const previousProviderId = complaint.providerId;
    if (previousProviderId && previousProviderId !== providerId) {
      emit(() =>
        RealtimeService.emitProviderUnassigned(
          previousProviderId,
          updated as unknown as Record<string, unknown>,
        ),
      );
    }
    // Outside business hours the 'complaint:assigned' popup is held back
    // (see emitProviderAssigned), but the new provider's list/task count
    // should still refresh silently if the app happens to be open.
    if (!withinHours) {
      emit(() => RealtimeService.emitComplaintUpdated(updated as unknown as Record<string, unknown>));
    }
    if (withinHours) {
      // If the provider's app is live and already subscribed to its realtime
      // channel, the emitProviderAssigned() broadcast above delivers
      // 'complaint:assigned' immediately and radix opens the job popup
      // straight from that — an FCM push at the same moment would just be a
      // redundant, slightly-delayed duplicate. Only fall back to push when
      // there's nobody listening on the socket to catch the realtime event.
      emit(async () => {
        const online = await RealtimeService.isProviderOnline(providerId);
        if (online) {
          logger.info('[Complaint] Provider is realtime-connected — skipping FCM push', { providerId, complaintId });
          return;
        }
        logger.info('[Complaint] Provider not realtime-connected — sending FCM push', { providerId, complaintId });
        return NotificationService.sendToUser({
          userId:      providerId,
          title:       'New Job Assigned',
          body:        `You have been assigned a new service complaint: "${complaint.title}"`,
          type:        NotificationType.COMPLAINT,
          complaintId,
          // Data-only — lets the provider app show a full-screen incoming-job
          // popup even when backgrounded/locked, instead of a plain tray notification.
          dataOnly:    true,
          // actionToken lets radix's native floating popup accept/reject
          // without opening the app — see respondToAssignmentWithToken.
          metadata:    {
            event:       'complaint_assigned',
            actionToken: ComplaintService.issueAssignmentActionToken(complaintId, providerId),
            ...assignmentPushDetails(updated),
          },
        });
      });
    }
    emit(() =>
      NotificationService.sendToUser({
        userId:      complaint.userId,
        title:       'Provider Assigned',
        body:        'A provider has been assigned to your complaint.',
        type:        NotificationType.COMPLAINT,
        complaintId,
      }),
    );

    return updated;
  }

  // Called when a provider's app opens (splash / cold start / resume) —
  // delivers every job-assignment popup that was deferred because it landed
  // outside business hours (there can be more than one), and clears each
  // deferral so the deadline sweep (see reassignExpiredPendingAssignments)
  // leaves them alone. Returns the complaints directly so the caller can
  // show all of them (queued one after another) immediately, rather than
  // waiting on a push/realtime round trip — no realtime/push emit here,
  // since this REST response is itself the delivery.
  static async claimPendingAssignments(providerId: string): Promise<ComplaintWithRelations[]> {
    const complaints = await prisma.complaint.findMany({
      where: {
        providerId,
        assignmentPending: true,
        isDeleted: false,
        stage: { notIn: [ComplaintStage.COMPLETED, ComplaintStage.REJECTED] },
      },
      orderBy: { createdAt: 'asc' },
      include: COMPLAINT_INCLUDE,
    });
    if (complaints.length === 0) return [];

    await prisma.complaint.updateMany({
      where: { id: { in: complaints.map((c) => c.id) } },
      data: { assignmentPending: false, assignmentDeadline: null },
    });

    for (const complaint of complaints) {
      await logComplaintEvent({
        complaintId: complaint.id,
        event: 'ASSIGNMENT_POPUP_DELIVERED',
        metadata: { providerId },
      });
    }

    return complaints;
  }

  // Background sweep (see jobs/assignmentDeadlineSweep.ts) — reassigns any
  // complaint whose provider never opened the app to see their deferred,
  // outside-business-hours assignment before the deadline. Mirrors
  // rejectAssignment's reassignment path, just triggered by a timeout
  // instead of an explicit reject.
  static async reassignExpiredPendingAssignments(): Promise<void> {
    const expired = await prisma.complaint.findMany({
      where: {
        assignmentPending: true,
        assignmentDeadline: { lt: new Date() },
        isDeleted: false,
        stage: { notIn: [ComplaintStage.COMPLETED, ComplaintStage.REJECTED] },
      },
    });

    for (const complaint of expired) {
      if (!complaint.providerId) continue;

      const rejectedProviderIds = [...complaint.rejectedProviderIds, complaint.providerId];

      // Guarded by `assignmentPending: true` in the WHERE clause, not just the
      // initial findMany above — closes the race where the provider opens the
      // app and claimPendingAssignment() clears the flag in between this
      // sweep's read and write. Without this check, a provider who claimed
      // their popup an instant before the sweep runs could still get yanked
      // off the job it just showed them.
      const { count } = await prisma.complaint.updateMany({
        where: { id: complaint.id, assignmentPending: true },
        data: {
          providerId:         null,
          providerAccepted:   false,
          providerAcceptedAt: null,
          assignmentPending:  false,
          assignmentDeadline: null,
          rejectedProviderIds,
        },
      });
      if (count === 0) continue;

      logger.info('[Complaint] Provider never opened app before assignment deadline — reassigning', {
        complaintId: complaint.id, providerId: complaint.providerId,
      });

      await logComplaintEvent({
        complaintId: complaint.id,
        event: 'ASSIGNMENT_EXPIRED_REASSIGNING',
        metadata: { providerId: complaint.providerId },
      });

      await ComplaintService.autoAssignProvider(complaint.id, rejectedProviderIds);
    }
  }

  static async acceptAssignment(complaintId: string, providerId: string) {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, providerId, isDeleted: false },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found or not assigned to you');

    if (complaint.providerAccepted) throw new ApiError(400, 'Assignment already accepted');

    const updated = await prisma.complaint.update({
      where: { id: complaintId },
      data: {
        providerAccepted:   true,
        providerAcceptedAt: new Date(),
      },
      include: COMPLAINT_INCLUDE,
    });

    await logComplaintEvent({
      complaintId,
      event: 'PROVIDER_ACCEPTED',
      actorId: providerId,
      actorRole: Role.PROVIDER,
    });

    emit(() =>
      RealtimeService.emitProviderAccepted(updated as unknown as Record<string, unknown>),
    );
    emit(() =>
      NotificationService.sendToUser({
        userId:      complaint.userId,
        title:       'Provider Accepted',
        body:        'Your provider has accepted the job and is on their way.',
        type:        NotificationType.COMPLAINT,
        complaintId,
      }),
    );

    return updated;
  }

  static async rejectAssignment(complaintId: string, providerId: string) {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, providerId, isDeleted: false },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found or not assigned to you');

    const updated = await prisma.complaint.update({
      where: { id: complaintId },
      data: {
        providerId:         null,
        providerAccepted:   false,
        providerAcceptedAt: null,
        rejectedProviderIds: { push: providerId },
      },
      include: COMPLAINT_INCLUDE,
    });

    await logComplaintEvent({
      complaintId,
      event: 'PROVIDER_REJECTED',
      actorId: providerId,
      actorRole: Role.PROVIDER,
    });

    emit(() =>
      RealtimeService.emitProviderRejected(updated as unknown as Record<string, unknown>),
    );
    emit(() =>
      NotificationService.sendToUser({
        userId:      complaint.userId,
        title:       'Provider Unavailable',
        body:        'Your assigned provider could not take the job. We are finding another.',
        type:        NotificationType.COMPLAINT,
        complaintId,
      }),
    );

    // Previously a rejection just cleared providerId and stopped there — the
    // complaint silently stalled unassigned until an admin manually
    // reassigned it, despite the notification above promising "we are
    // finding another." Re-run auto-assign excluding everyone who's already
    // rejected this complaint.
    emit(() => ComplaintService.autoAssignProvider(complaintId, updated.rejectedProviderIds));

    return updated;
  }

  // ─── Assignment actions from the native popup (token-authenticated) ───────

  static issueAssignmentActionToken(complaintId: string, providerId: string): string {
    return jwt.sign(
      { purpose: ASSIGNMENT_ACTION_PURPOSE, complaintId, providerId },
      assignmentActionSecret(),
      { expiresIn: ASSIGNMENT_ACTION_EXPIRY },
    );
  }

  // For the realtime-socket path: radix's JS gets the same token over its
  // normal authenticated session before handing the alert to native code.
  static async getAssignmentActionToken(complaintId: string, providerId: string): Promise<string> {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, providerId, isDeleted: false },
      select: { id: true },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found or not assigned to you');
    return ComplaintService.issueAssignmentActionToken(complaintId, providerId);
  }

  // Only valid while the job is still awaiting this provider's decision —
  // once accepted (or reassigned), a leaked/replayed token can't flip it.
  static async respondToAssignmentWithToken(complaintId: string, token: string, action: AssignmentAction) {
    let claims: { purpose?: string; complaintId?: string; providerId?: string };
    try {
      claims = jwt.verify(token, assignmentActionSecret()) as typeof claims;
    } catch {
      throw new ApiError(401, 'This job offer has expired. Open the app to respond.');
    }
    if (claims.purpose !== ASSIGNMENT_ACTION_PURPOSE || claims.complaintId !== complaintId || !claims.providerId) {
      throw new ApiError(401, 'Invalid job offer link');
    }

    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, isDeleted: false },
      select: { providerId: true, providerAccepted: true },
    });
    if (!complaint || complaint.providerId !== claims.providerId) {
      throw new ApiError(409, 'This job is no longer assigned to you');
    }
    if (complaint.providerAccepted) {
      throw new ApiError(409, 'You have already accepted this job');
    }

    return action === 'accept'
      ? ComplaintService.acceptAssignment(complaintId, claims.providerId)
      : ComplaintService.rejectAssignment(complaintId, claims.providerId);
  }

  // ─── Quote ────────────────────────────────────────────────────────────────

  static async addQuote({ complaintId, requesterId, asAdmin, items, notes }: AddQuoteInput) {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, ...(asAdmin ? {} : { providerId: requesterId }), isDeleted: false },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found or not assigned to you');

    // An admin can enter a quote on the provider's behalf (e.g. phoned-in
    // estimate), but there must already be a provider assigned — a quote is
    // inherently that provider's estimate, not something an admin invents
    // for an unassigned complaint.
    if (asAdmin && !complaint.providerId) {
      throw new ApiError(400, 'Assign a provider before adding a quote');
    }

    if (
      complaint.stage !== ComplaintStage.QR_VALIDATED &&
      complaint.stage !== ComplaintStage.ESTIMATION
    ) {
      throw new ApiError(400, 'Quote can only be submitted after QR validation');
    }

    // Catalogue items (partId set) get their name/price re-resolved from the
    // CMS *now*, at estimation time — the client's own unitPrice is never
    // trusted for these, since it may have been read from a stale cache.
    // Once written into Quote.items (plain JSON), this is a permanent
    // snapshot: a later CMS price change can never retroactively change an
    // already-created quote's total, so payouts/invoices computed from it
    // stay consistent even after the CMS price moves.
    //
    // Exception: `priceOverridden` is an explicit admin backdoor for when the
    // real cost ran higher than the listed catalogue price — the client's
    // unitPrice is trusted verbatim in that case (still snapshotted the same
    // way, just sourced from the admin's own number instead of the CMS).
    const snapshotItems = await Promise.all(
      items.map(async (item) => {
        if (!item.partId || item.priceOverridden) return item;
        const part = await StrapiService.fetchPartByDocumentId(item.partId);
        if (!part) return item;
        return { ...item, name: part.name, unitPrice: part.face_value };
      }),
    );

    const totalAmount = snapshotItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

    const quote = await prisma.quote.upsert({
      where:  { complaintId },
      update: { items: snapshotItems, totalAmount, notes: notes ?? null, status: QuoteStatus.PENDING },
      create: { complaintId, items: snapshotItems, totalAmount, notes: notes ?? null },
    });

    // Move stage to APPROVAL so customer can review
    const updatedComplaint = await prisma.complaint.update({
      where: { id: complaintId },
      data:  { stage: ComplaintStage.APPROVAL },
      include: COMPLAINT_INCLUDE,
    });

    await logComplaintEvent({
      complaintId,
      event: 'QUOTE_ADDED',
      fromStage: complaint.stage,
      toStage: ComplaintStage.APPROVAL,
      actorId: requesterId,
      actorRole: asAdmin ? Role.ADMIN : Role.PROVIDER,
      metadata: { totalAmount },
    });

    emit(() =>
      RealtimeService.emitQuoteAdded(updatedComplaint as unknown as Record<string, unknown>),
    );
    emit(() =>
      NotificationService.sendToUser({
        userId:      complaint.userId,
        title:       'Quote Ready',
        body:        `Your provider submitted a quote of ₹${totalAmount.toFixed(2)}. Please review and approve.`,
        type:        NotificationType.COMPLAINT,
        complaintId,
        metadata:    { totalAmount },
      }),
    );

    return { complaint: updatedComplaint, quote };
  }

  static async respondToQuote({ complaintId, userId, approved, rejectionReason, asAdmin }: RespondToQuoteInput) {
    const complaint = await prisma.complaint.findFirst({
      where:   { id: complaintId, ...(asAdmin ? {} : { userId }), isDeleted: false },
      include: { quote: true },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found');
    if (!complaint.quote) throw new ApiError(400, 'No quote found for this complaint');
    if (complaint.stage !== ComplaintStage.APPROVAL) {
      throw new ApiError(400, 'No quote pending approval');
    }

    if (approved) {
      // Non-zero quotes move to IN_PROGRESS — the provider is now expected to
      // actually do the repair before calling completeService() to advance to
      // PAYMENT. Zero-amount quotes skip both (nothing to pay for), same as before.
      const nextStage =
        complaint.quote.totalAmount === 0
          ? ComplaintStage.COMPLETED
          : ComplaintStage.IN_PROGRESS;

      const [updatedComplaint] = await prisma.$transaction([
        prisma.complaint.update({
          where: { id: complaintId },
          data:  { stage: nextStage },
          include: COMPLAINT_INCLUDE,
        }),
        prisma.quote.update({
          where: { complaintId },
          data:  { status: QuoteStatus.APPROVED },
        }),
      ]);

      await logComplaintEvent({
        complaintId,
        event: 'QUOTE_APPROVED',
        fromStage: ComplaintStage.APPROVAL,
        toStage: nextStage,
        actorId: userId,
        actorRole: asAdmin ? Role.ADMIN : Role.CUSTOMER,
      });

      emit(() =>
        RealtimeService.emitQuoteResponded(
          updatedComplaint as unknown as Record<string, unknown>,
          true,
        ),
      );
      emit(() =>
        NotificationService.sendToUser({
          userId:      complaint.providerId!,
          title:       'Quote Approved',
          body:        'The customer approved your quote. Please proceed with the service.',
          type:        NotificationType.COMPLAINT,
          complaintId,
        }),
      );

      if (nextStage === ComplaintStage.COMPLETED) {
        const links = await prisma.complaintDevice.findMany({ where: { complaintId }, select: { deviceId: true } });
        await ComplaintService.recordServiceCompletionHistory(links.map((l) => l.deviceId), complaint.quote.items);
      }

      return updatedComplaint;
    } else {
      // Rejected — customer declined the quote, close the complaint
      const [updatedComplaint] = await prisma.$transaction([
        prisma.complaint.update({
          where: { id: complaintId },
          data:  {
            stage:           ComplaintStage.REJECTED,
            rejectionReason: rejectionReason ?? null,
            rejectedAt:      new Date(),
            rejectedBy:      userId,
          },
          include: COMPLAINT_INCLUDE,
        }),
        prisma.quote.update({
          where: { complaintId },
          data:  { status: QuoteStatus.REJECTED },
        }),
      ]);

      await logComplaintEvent({
        complaintId,
        event: 'QUOTE_REJECTED',
        fromStage: ComplaintStage.APPROVAL,
        toStage: ComplaintStage.REJECTED,
        actorId: userId,
        actorRole: asAdmin ? Role.ADMIN : Role.CUSTOMER,
        ...(rejectionReason && { metadata: { rejectionReason } }),
      });

      emit(() =>
        RealtimeService.emitQuoteResponded(
          updatedComplaint as unknown as Record<string, unknown>,
          false,
        ),
      );
      emit(() =>
        NotificationService.sendToUser({
          userId:      complaint.providerId!,
          title:       'Quote Rejected',
          body:        rejectionReason
            ? `Customer rejected the quote: "${rejectionReason}". The complaint has been closed.`
            : 'Customer rejected the quote. The complaint has been closed.',
          type:        NotificationType.COMPLAINT,
          complaintId,
        }),
      );

      return updatedComplaint;
    }
  }

  // ─── Link Device ──────────────────────────────────────────────────────────

  // A provider identifies the physical units on-site — each item either
  // points at a device the customer already owns (deviceId) or describes a
  // brand-new one to create (deviceKey + metadata), matching the same
  // validation DeviceService.addDevice applies. Devices never need to
  // pre-exist at complaint-creation time; this is where they actually get
  // created/linked.
  static async linkDevice({ complaintId, requesterId, requesterRole, devices }: LinkDeviceInput) {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, isDeleted: false },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found');

    // 404, not 403 — standardized 2026-09-12, see getById for rationale.
    if (requesterRole === Role.PROVIDER) {
      if (complaint.providerId !== requesterId) {
        throw new ApiError(404, 'Complaint not found or not assigned to you');
      }
    } else if (requesterRole !== Role.ADMIN) {
      if (complaint.userId !== requesterId) {
        throw new ApiError(404, 'Complaint not found');
      }
    }

    const linkedDeviceIds: string[] = [];
    for (const item of devices) {
      if (item.deviceId) {
        // Existing device — must belong to the complaint's customer.
        const device = await prisma.device.findFirst({
          where: { id: item.deviceId, userId: complaint.userId, isDeleted: false },
        });
        if (!device) throw new ApiError(404, 'Device not found');
        linkedDeviceIds.push(device.id);
        continue;
      }

      // Brand-new device — validate its metadata the same way DeviceService.addDevice does.
      const deviceKey = item.deviceKey as DeviceKey;
      const validator = DEVICE_META_VALIDATORS[deviceKey];
      if (!validator) throw new ApiError(400, `Unknown device key: ${deviceKey}`);

      const parsed = validator.safeParse(item.metadata ?? {});
      if (!parsed.success) throw new ApiError(400, describeZodError(parsed.error), parsed.error.issues);

      const created = await prisma.device.create({
        data: {
          userId:    complaint.userId,
          addressId: complaint.addressId,
          deviceKey,
          type:      DEVICE_KEY_TO_TYPE[deviceKey],
          imageUrl:  item.imageUrl ?? null,
          metadata:  parsed.data,
        },
      });
      linkedDeviceIds.push(created.id);
    }

    await prisma.complaintDevice.createMany({
      data: linkedDeviceIds.map((deviceId) => ({ complaintId, deviceId })),
      skipDuplicates: true,
    });

    const wasQrValidated = complaint.stage === ComplaintStage.QR_VALIDATED;
    const updated = await prisma.complaint.update({
      where: { id: complaintId },
      data: {
        stage: wasQrValidated ? ComplaintStage.ESTIMATION : complaint.stage,
      },
      include: COMPLAINT_INCLUDE,
    });

    // Devices can also be linked by an admin from watchtower — the assigned
    // provider's copy of this complaint (and its stage) must refresh either way.
    emit(() =>
      wasQrValidated
        ? RealtimeService.emitStageChanged(
            updated as unknown as Record<string, unknown>,
            ComplaintStage.QR_VALIDATED,
            ComplaintStage.ESTIMATION,
          )
        : RealtimeService.emitComplaintUpdated(updated as unknown as Record<string, unknown>),
    );

    if (wasQrValidated) {
      emit(() =>
        NotificationService.sendToUser({
          userId:      complaint.userId,
          title:       'Inspection Started',
          body:        'Your technician has identified the appliance and started the inspection.',
          type:        NotificationType.SERVICE,
          complaintId,
        }),
      );
    }

    return updated;
  }

  // ─── Entry QR ─────────────────────────────────────────────────────────────

  static async generateEntryQr(complaintId: string, userId: string) {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, userId, isDeleted: false },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found');

    if (
      complaint.stage !== ComplaintStage.ENTRANCE &&
      complaint.stage !== ComplaintStage.QR_VALIDATED
    ) {
      throw new ApiError(400, 'QR can only be generated during entry stage');
    }

    const token    = randomUUID();
    const expiresAt = generateQrExpiry();

    await prisma.complaint.update({
      where: { id: complaintId },
      data: { entryQrToken: token, entryQrExpiresAt: expiresAt },
    });

    return { token, expiresAt };
  }

  static async validateEntryQr({ complaintId, token, providerId }: ValidateQrInput) {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, providerId, isDeleted: false },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found or not assigned to you');

    if (complaint.stage !== ComplaintStage.ENTRANCE) {
      throw new ApiError(400, 'QR already validated');
    }
    if (complaint.entryQrToken !== token) {
      throw new ApiError(400, 'Invalid QR token');
    }
    if (!complaint.entryQrExpiresAt || complaint.entryQrExpiresAt < new Date()) {
      throw new ApiError(400, 'QR token has expired. Ask the customer to regenerate.');
    }

    const updated = await prisma.complaint.update({
      where: { id: complaintId },
      data: {
        stage:           ComplaintStage.QR_VALIDATED,
        entryQrToken:    null,
        entryQrExpiresAt: null,
      },
      include: COMPLAINT_INCLUDE,
    });

    await logComplaintEvent({
      complaintId,
      event: 'STAGE_CHANGED',
      fromStage: ComplaintStage.ENTRANCE,
      toStage: ComplaintStage.QR_VALIDATED,
      actorId: providerId,
      actorRole: Role.PROVIDER,
    });

    emit(() =>
      RealtimeService.emitStageChanged(
        updated as unknown as Record<string, unknown>,
        ComplaintStage.ENTRANCE,
        ComplaintStage.QR_VALIDATED,
      ),
    );
    emit(() =>
      NotificationService.sendToUser({
        userId:      complaint.userId,
        title:       'Provider Arrived',
        body:        'Your provider has verified their arrival. Service is starting.',
        type:        NotificationType.COMPLAINT,
        complaintId,
      }),
    );

    return updated;
  }

  static async requestEntranceScan(complaintId: string, providerId: string) {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, providerId, isDeleted: false },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found or not assigned to you');

    if (complaint.stage !== ComplaintStage.ENTRANCE) {
      throw new ApiError(400, 'Entry scan only applicable during ENTRANCE stage');
    }

    // Generate/refresh token if missing or expired
    const isExpired = !complaint.entryQrExpiresAt || complaint.entryQrExpiresAt < new Date();
    let token = complaint.entryQrToken;

    if (!token || isExpired) {
      token = randomUUID();
      await prisma.complaint.update({
        where: { id: complaintId },
        data:  { entryQrToken: token, entryQrExpiresAt: generateQrExpiry() },
      });
    }

    emit(() =>
      RealtimeService.emitQrScanRequested(
        complaint as unknown as Record<string, unknown>,
        token!,
      ),
    );
    emit(() =>
      NotificationService.sendToUser({
        userId:      complaint.userId,
        title:       'Show Your QR Code',
        body:        'Your provider is at your location and needs to scan your QR code.',
        type:        NotificationType.COMPLAINT,
        complaintId,
      }),
    );

    return { message: 'Scan request sent to customer' };
  }

  // ─── Reopen ───────────────────────────────────────────────────────────────

  static async reopenComplaint({
    complaintId,
    userId,
    asAdmin,
    title,
    notes,
    addressId,
  }: ReopenComplaintInput): Promise<ComplaintWithRelations> {
    const original = await prisma.complaint.findFirst({
      where: { id: complaintId, ...(asAdmin ? {} : { userId }), isDeleted: false },
    });
    if (!original) throw new ApiError(404, 'Complaint not found');

    if (
      original.stage !== ComplaintStage.COMPLETED &&
      original.stage !== ComplaintStage.REJECTED
    ) {
      throw new ApiError(400, 'Only completed or rejected complaints can be reopened');
    }

    const ownerId = asAdmin ? original.userId : userId;

    let newComplaint = await prisma.complaint.create({
      data: {
        userId:    ownerId,
        title:     title ?? original.title,
        notes:     notes ?? null,
        addressId: addressId ?? original.addressId,
        groupId:   original.groupId,
        requestedDevices: original.requestedDevices ?? Prisma.JsonNull,
        stage:     ComplaintStage.ENTRANCE,
        parentId:  complaintId,
      },
      include: COMPLAINT_INCLUDE,
    });

    // Carry over whichever physical devices were already identified on the
    // original complaint — the reopened job is presumably about the same units.
    const originalLinks = await prisma.complaintDevice.findMany({ where: { complaintId }, select: { deviceId: true } });
    if (originalLinks.length > 0) {
      await prisma.complaintDevice.createMany({
        data: originalLinks.map((l) => ({ complaintId: newComplaint.id, deviceId: l.deviceId })),
        skipDuplicates: true,
      });
      // Re-fetch — the object above was fetched before these links existed,
      // so its `devices` include would otherwise come back empty.
      newComplaint = await prisma.complaint.findUniqueOrThrow({
        where: { id: newComplaint.id },
        include: COMPLAINT_INCLUDE,
      });
    }

    await logComplaintEvent({
      complaintId: newComplaint.id,
      event: 'REOPENED',
      toStage: ComplaintStage.ENTRANCE,
      actorId: userId,
      actorRole: asAdmin ? Role.ADMIN : Role.CUSTOMER,
      metadata: { originalComplaintId: complaintId },
    });

    emit(() =>
      NotificationService.sendToUser({
        userId: ownerId,
        title: 'Complaint Reopened',
        body:  'Your complaint has been reopened. We are finding a provider.',
        type:  NotificationType.COMPLAINT,
        complaintId: newComplaint.id,
      }),
    );

    // The notification above promises "we are finding a provider" — this is
    // a fresh complaint created via a raw prisma.complaint.create (not the
    // createComplaint() path), so it never actually triggered auto-assign
    // without this call. Same class of gap as rejectAssignment.
    emit(() => ComplaintService.autoAssignProvider(newComplaint.id, []));

    return newComplaint;
  }

  // ─── Dev: force-advance stage (non-production only) ──────────────────────

  static async devAdvance(complaintId: string): Promise<ComplaintWithRelations> {
    const complaint = await prisma.complaint.findFirst({
      where:   { id: complaintId, isDeleted: false },
      include: COMPLAINT_INCLUDE,
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found');

    // Step 1: if no provider, assign one and accept
    if (!complaint.providerId || !complaint.providerAccepted) {
      let providerId = complaint.providerId;
      if (!providerId) {
        const provider = await prisma.user.findFirst({
          where: { role: Role.PROVIDER, isActive: true, isDeleted: false },
        });
        if (!provider) throw new ApiError(400, 'No providers available to auto-assign');
        providerId = provider.id;
      }
      return prisma.complaint.update({
        where: { id: complaintId },
        data: {
          providerId,
          providerAccepted:   true,
          providerAcceptedAt: new Date(),
        },
        include: COMPLAINT_INCLUDE,
      });
    }

    // Step 2: advance based on current stage
    switch (complaint.stage) {
      case ComplaintStage.ENTRANCE:
        return prisma.complaint.update({
          where: { id: complaintId },
          data:  { stage: ComplaintStage.QR_VALIDATED, entryQrToken: null, entryQrExpiresAt: null },
          include: COMPLAINT_INCLUDE,
        });

      // QR_VALIDATED and ESTIMATION are both provider-side steps — advance through
      // both in one go and land on APPROVAL so the customer sees the quote UI.
      case ComplaintStage.QR_VALIDATED:
      case ComplaintStage.ESTIMATION: {
        const totalAmount = 500;
        await prisma.quote.upsert({
          where:  { complaintId },
          update: { items: [{ name: 'Dev Test Service', unitPrice: totalAmount, quantity: 1 }], totalAmount, notes: '[DEV] Auto-generated quote', status: QuoteStatus.PENDING },
          create: { complaintId, items: [{ name: 'Dev Test Service', unitPrice: totalAmount, quantity: 1 }], totalAmount, notes: '[DEV] Auto-generated quote' },
        });
        return prisma.complaint.update({
          where: { id: complaintId },
          data:  { stage: ComplaintStage.APPROVAL },
          include: COMPLAINT_INCLUDE,
        });
      }

      case ComplaintStage.APPROVAL: {
        const [updated] = await prisma.$transaction([
          prisma.complaint.update({
            where: { id: complaintId },
            data:  { stage: ComplaintStage.IN_PROGRESS },
            include: COMPLAINT_INCLUDE,
          }),
          prisma.quote.update({
            where: { complaintId },
            data:  { status: QuoteStatus.APPROVED },
          }),
        ]);
        return updated as ComplaintWithRelations;
      }

      case ComplaintStage.IN_PROGRESS:
        return prisma.complaint.update({
          where: { id: complaintId },
          data:  { stage: ComplaintStage.PAYMENT },
          include: COMPLAINT_INCLUDE,
        });

      case ComplaintStage.PAYMENT:
        return prisma.complaint.update({
          where: { id: complaintId },
          data:  { stage: ComplaintStage.COMPLETED },
          include: COMPLAINT_INCLUDE,
        });

      default:
        throw new ApiError(400, `Cannot advance from stage ${complaint.stage}`);
    }
  }

  // ─── Complete Service (provider marks the repair itself done) ────────────

  static async completeService(complaintId: string, providerId: string) {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, providerId, isDeleted: false },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found or not assigned to you');
    if (complaint.stage !== ComplaintStage.IN_PROGRESS) {
      throw new ApiError(400, 'Complaint is not in progress');
    }

    const updated = await prisma.complaint.update({
      where: { id: complaintId },
      data:  { stage: ComplaintStage.PAYMENT },
      include: COMPLAINT_INCLUDE,
    });

    await logComplaintEvent({
      complaintId,
      event: 'STAGE_CHANGED',
      fromStage: ComplaintStage.IN_PROGRESS,
      toStage: ComplaintStage.PAYMENT,
      actorId: providerId,
      actorRole: Role.PROVIDER,
    });

    emit(() =>
      RealtimeService.emitStageChanged(
        updated as unknown as Record<string, unknown>,
        ComplaintStage.IN_PROGRESS,
        ComplaintStage.PAYMENT,
      ),
    );
    emit(() =>
      NotificationService.sendToUser({
        userId:      complaint.userId,
        title:       'Repair Completed',
        body:        'Your device has been repaired. Please complete payment to close the request.',
        type:        NotificationType.COMPLAINT,
        complaintId,
      }),
    );

    return updated;
  }

  // ─── Complete Payment ─────────────────────────────────────────────────────

  // Auto-records a REPAIR (or FILTER_CHANGE, if the quote looks filter-related)
  // work-history entry against every device linked to the complaint whenever
  // a service completes — a complaint can now cover multiple devices (all in
  // the same DeviceTypeGroup), so this records one entry per device.
  private static async recordServiceCompletionHistory(
    deviceIds: string[],
    quoteItems: unknown,
  ): Promise<void> {
    if (deviceIds.length === 0) return;
    try {
      const event = isFilterRelatedQuote(quoteItems) ? WorkHistoryEvent.FILTER_CHANGE : WorkHistoryEvent.REPAIR;
      await prisma.deviceWorkHistory.createMany({
        data: deviceIds.map((deviceId) => ({ deviceId, event, eventDate: new Date() })),
      });
    } catch (error) {
      logger.error('Failed to record service completion history', { error, deviceIds });
    }
  }

  static async completePayment({ complaintId, providerId, method }: CompletePaymentInput) {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, providerId, isDeleted: false },
      include: { quote: true },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found or not assigned to you');
    if (complaint.stage !== ComplaintStage.PAYMENT) {
      throw new ApiError(400, 'Complaint is not in PAYMENT stage');
    }

    const totalAmount = complaint.quote?.totalAmount ?? 0;
    const paymentProvider = method === 'CASH' ? PaymentProvider.CASH : PaymentProvider.RAZORPAY;

    const updated = await prisma.$transaction(
      async (tx) => {
        // For WALLET payments, actually charge the customer before crediting
        // the provider or closing the complaint — previously `method: 'WALLET'`
        // completed the job and paid the provider with no verification the
        // customer had the funds (or any wallet debit at all). Insufficient
        // balance throws and rolls back the whole transaction: complaint stays
        // in PAYMENT, provider isn't credited, customer isn't charged.
        if (method === 'WALLET' && totalAmount > 0) {
          await WalletService.debitCustomerForComplaintPayment(complaint.userId, totalAmount, complaintId, tx);
        }

        const updatedComplaint = await tx.complaint.update({
          where: { id: complaintId },
          data:  { stage: ComplaintStage.COMPLETED },
          include: COMPLAINT_INCLUDE,
        });

        // Credit provider wallet — routed through WalletService for the same
        // serializable-isolation / audit-ledger guarantees every other wallet
        // mutation gets, composed inside this same transaction.
        if (totalAmount > 0) {
          await WalletService.creditProviderEarnings(providerId, totalAmount, complaintId, paymentProvider, tx);
        }

        return updatedComplaint;
      },
      // Serializable: prevents a customer from completing two WALLET-paid jobs
      // concurrently and having both balance checks pass against the same
      // pre-debit balance (the classic concurrent-overdraft race).
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const deviceLinks = await prisma.complaintDevice.findMany({ where: { complaintId }, select: { deviceId: true } });
    await ComplaintService.recordServiceCompletionHistory(deviceLinks.map((l) => l.deviceId), complaint.quote?.items);

    await logComplaintEvent({
      complaintId,
      event: 'STAGE_CHANGED',
      fromStage: ComplaintStage.PAYMENT,
      toStage: ComplaintStage.COMPLETED,
      actorId: providerId,
      actorRole: Role.PROVIDER,
      metadata: { method, totalAmount },
    });

    emit(() =>
      RealtimeService.emitStageChanged(
        updated as unknown as Record<string, unknown>,
        ComplaintStage.PAYMENT,
        ComplaintStage.COMPLETED,
      ),
    );
    emit(() =>
      NotificationService.sendToUser({
        userId:      complaint.userId,
        title:       'Service Completed',
        body:        'Payment received. Your complaint has been closed successfully.',
        type:        NotificationType.PAYMENT,
        complaintId,
      }),
    );
    emit(() =>
      NotificationService.sendToUser({
        userId:      providerId,
        title:       'Job Closed',
        body:        `₹${totalAmount} has been deposited to your wallet.`,
        type:        NotificationType.PAYMENT,
        complaintId,
      }),
    );

    return updated;
  }

  // ─── Delete ───────────────────────────────────────────────────────────────

  static async deleteComplaint(complaintId: string, requesterId: string, requesterRole: Role) {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, isDeleted: false },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found');

    // 404, not 403 — standardized 2026-09-12, see getById for rationale.
    if (requesterRole !== Role.ADMIN && complaint.userId !== requesterId) {
      throw new ApiError(404, 'Complaint not found');
    }

    if (
      requesterRole !== Role.ADMIN &&
      complaint.stage !== ComplaintStage.ENTRANCE &&
      complaint.stage !== ComplaintStage.REJECTED
    ) {
      throw new ApiError(400, 'Active complaints can only be deleted by an admin');
    }

    const deleted = await prisma.complaint.update({
      where: { id: complaintId },
      data:  { isDeleted: true },
    });

    // Drops the job off the assigned provider's list (admin delete from watchtower).
    emit(() => RealtimeService.emitComplaintUpdated(deleted as unknown as Record<string, unknown>));

    return deleted;
  }
}
