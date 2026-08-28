import { ComplaintStage, NotificationType, PaymentProvider, Prisma, QuoteStatus, Role, WorkHistoryEvent } from '@prisma/client';
import { randomUUID } from 'crypto';
import prisma from '@/services/prisma.service';
import { ApiError } from '@/utils/apiResponse';
import { logger } from '@/utils/logger';
import { RealtimeService } from '@/services/realtime.service';
import { NotificationService } from '@/services/notification.service';
import { TelegramService } from '@/services/telegram.service';
import { WalletService } from '@/services/wallet.service';
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
  device: {
    select: { id: true, type: true, deviceKey: true, imageUrl: true, metadata: true },
  },
  media: {
    where:   { isDeleted: false },
    orderBy: { createdAt: 'asc' as const },
  },
  quote: true,
} satisfies Prisma.ComplaintInclude;

type ComplaintWithRelations = Prisma.ComplaintGetPayload<{ include: typeof COMPLAINT_INCLUDE }>;

// ---------------------------------------------------------------------------
// Stage transition rules
// ---------------------------------------------------------------------------

const STAGE_TRANSITIONS: Record<ComplaintStage, ComplaintStage[]> = {
  [ComplaintStage.ENTRANCE]:    [ComplaintStage.QR_VALIDATED, ComplaintStage.REJECTED],
  [ComplaintStage.QR_VALIDATED]: [ComplaintStage.ESTIMATION, ComplaintStage.REJECTED],
  [ComplaintStage.ESTIMATION]:  [ComplaintStage.APPROVAL, ComplaintStage.REJECTED],
  [ComplaintStage.APPROVAL]:    [ComplaintStage.PAYMENT, ComplaintStage.REJECTED],
  [ComplaintStage.PAYMENT]:     [ComplaintStage.COMPLETED, ComplaintStage.REJECTED],
  [ComplaintStage.COMPLETED]:   [],
  [ComplaintStage.REJECTED]:    [],
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

function emit(fn: () => Promise<unknown>): void {
  fn().catch((err) => logger.error('[Complaint] Background task failed:', err));
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

  // A request naming multiple devices raises one complaint per device — each
  // gets its own provider assignment / stage lifecycle, and is tagged with
  // that specific device's own type rather than one shared deviceKey.
  static async createComplaint({
    userId,
    title,
    notes,
    addressId,
    deviceId,
    deviceIds,
    deviceKey,
  }: CreateComplaintInput): Promise<ComplaintWithRelations[]> {
    const address = await prisma.address.findFirst({
      where: { id: addressId, userId, isDeleted: false },
    });
    if (!address) throw new ApiError(404, 'Address not found');

    const ids = deviceIds?.length ? deviceIds : [deviceId];

    const complaints: ComplaintWithRelations[] = [];
    for (const id of ids) {
      let resolvedDeviceKey = deviceKey ?? null;

      if (id) {
        const device = await prisma.device.findFirst({
          where: { id, userId, isDeleted: false },
        });
        if (!device) throw new ApiError(404, 'Device not found');
        resolvedDeviceKey = device.deviceKey;
      }

      complaints.push(
        await ComplaintService.createOne({ userId, title, notes, addressId, deviceId: id, deviceKey: resolvedDeviceKey }),
      );
    }

    return complaints;
  }

  private static async createOne({
    userId,
    title,
    notes,
    addressId,
    deviceId,
    deviceKey,
  }: {
    userId: string;
    title: string;
    notes?: string;
    addressId: string;
    deviceId?: string;
    deviceKey: string | null;
  }): Promise<ComplaintWithRelations> {
    const complaint = await prisma.complaint.create({
      data: {
        userId,
        title,
        notes:     notes ?? null,
        addressId,
        deviceId:  deviceId ?? null,
        deviceKey,
        stage:     ComplaintStage.ENTRANCE,
      },
      include: COMPLAINT_INCLUDE,
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

    // Auto-assign the best available provider
    emit(() => ComplaintService.autoAssignProvider(complaint.id, []));

    emit(() => TelegramService.notifyComplaintCreated(complaint));

    return complaint;
  }

  // ─── Auto-assign ──────────────────────────────────────────────────────────

  static async autoAssignProvider(complaintId: string, excludeIds: string[]): Promise<void> {
    const complaint = await prisma.complaint.findFirst({
      where:   { id: complaintId, isDeleted: false },
      include: { device: { select: { type: true } } },
    });
    if (!complaint) {
      logger.warn('[Complaint] autoAssignProvider called for missing complaint', { complaintId });
      return;
    }

    // Only providers whose skills include the complaint's device type are eligible.
    // If the complaint has no linked device yet, its device type is unknown, so
    // fall back to matching any active provider rather than blocking assignment.
    const deviceType = complaint.device?.type ?? null;

    const providers = await prisma.user.findMany({
      where: {
        role:      Role.PROVIDER,
        isActive:  true,
        isDeleted: false,
        id: excludeIds.length > 0 ? { notIn: excludeIds } : undefined,
        ...(deviceType && { providerProfile: { skills: { has: deviceType } } }),
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
        complaintId, deviceType, excludeIds,
      });
      // Leave the complaint unassigned rather than assigning a provider without
      // the matching skill — flag admins so they can assign one manually.
      emit(() => TelegramService.notifyNoProviderMatch(complaint, deviceType));
      return;
    }

    // Pick provider with fewest active complaints (basic load balancing)
    const best = providers.reduce((a, b) =>
      a._count.complaintsAsProvider <= b._count.complaintsAsProvider ? a : b,
    );

    logger.info('[Complaint] Auto-assigning provider', {
      complaintId, providerId: best.id, deviceType, candidateCount: providers.length,
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

    if (
      requesterRole !== Role.ADMIN &&
      complaint.userId !== requesterId &&
      complaint.providerId !== requesterId
    ) {
      throw new ApiError(403, 'Forbidden');
    }

    return complaint;
  }

  // ─── Stage ────────────────────────────────────────────────────────────────

  static async updateStage({
    complaintId,
    stage,
    rejectionReason,
    updatedById,
  }: UpdateStageInput): Promise<ComplaintWithRelations> {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, isDeleted: false },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found');

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

  static async assignProvider({ complaintId, providerId }: AssignProviderInput) {
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

    const updated = await prisma.complaint.update({
      where: { id: complaintId },
      data: {
        providerId,
        providerAccepted:   false,
        providerAcceptedAt: null,
      },
      include: COMPLAINT_INCLUDE,
    });

    emit(() =>
      RealtimeService.emitProviderAssigned(updated as unknown as Record<string, unknown>),
    );
    emit(() =>
      NotificationService.sendToUser({
        userId:      providerId,
        title:       'New Job Assigned',
        body:        `You have been assigned a new service complaint: "${complaint.title}"`,
        type:        NotificationType.COMPLAINT,
        complaintId,
        // Data-only — lets the provider app show a full-screen incoming-job
        // popup even when backgrounded/locked, instead of a plain tray notification.
        dataOnly:    true,
        metadata:    { event: 'complaint_assigned' },
      }),
    );
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

    return updated;
  }

  // ─── Quote ────────────────────────────────────────────────────────────────

  static async addQuote({ complaintId, providerId, items, notes }: AddQuoteInput) {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, providerId, isDeleted: false },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found or not assigned to you');

    if (
      complaint.stage !== ComplaintStage.QR_VALIDATED &&
      complaint.stage !== ComplaintStage.ESTIMATION
    ) {
      throw new ApiError(400, 'Quote can only be submitted after QR validation');
    }

    const totalAmount = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

    const quote = await prisma.quote.upsert({
      where:  { complaintId },
      update: { items, totalAmount, notes: notes ?? null, status: QuoteStatus.PENDING },
      create: { complaintId, items, totalAmount, notes: notes ?? null },
    });

    // Move stage to APPROVAL so customer can review
    const updatedComplaint = await prisma.complaint.update({
      where: { id: complaintId },
      data:  { stage: ComplaintStage.APPROVAL },
      include: COMPLAINT_INCLUDE,
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
      const nextStage =
        complaint.quote.totalAmount === 0
          ? ComplaintStage.COMPLETED
          : ComplaintStage.PAYMENT;

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
        await ComplaintService.recordServiceCompletionHistory(complaint.deviceId, complaint.quote.items);
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

  static async linkDevice({ complaintId, requesterId, requesterRole, deviceId, deviceKey }: LinkDeviceInput) {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, isDeleted: false },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found');

    if (requesterRole === Role.PROVIDER) {
      if (complaint.providerId !== requesterId) {
        throw new ApiError(403, 'This complaint is not assigned to you');
      }
    } else if (requesterRole !== Role.ADMIN) {
      if (complaint.userId !== requesterId) {
        throw new ApiError(403, 'Forbidden');
      }
    }

    // Device must belong to the complaint's customer
    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId: complaint.userId, isDeleted: false },
    });
    if (!device) throw new ApiError(404, 'Device not found');

    const updated = await prisma.complaint.update({
      where: { id: complaintId },
      data: {
        deviceId,
        deviceKey: deviceKey ?? device.deviceKey,
        stage:     complaint.stage === ComplaintStage.QR_VALIDATED ? ComplaintStage.ESTIMATION : complaint.stage,
      },
      include: COMPLAINT_INCLUDE,
    });

    if (complaint.stage === ComplaintStage.QR_VALIDATED) {
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

    const newComplaint = await prisma.complaint.create({
      data: {
        userId:    ownerId,
        title:     title ?? original.title,
        notes:     notes ?? null,
        addressId: addressId ?? original.addressId,
        deviceId:  original.deviceId,
        deviceKey: original.deviceKey,
        stage:     ComplaintStage.ENTRANCE,
        parentId:  complaintId,
      },
      include: COMPLAINT_INCLUDE,
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
            data:  { stage: ComplaintStage.PAYMENT },
            include: COMPLAINT_INCLUDE,
          }),
          prisma.quote.update({
            where: { complaintId },
            data:  { status: QuoteStatus.APPROVED },
          }),
        ]);
        return updated as ComplaintWithRelations;
      }

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

  // ─── Complete Payment ─────────────────────────────────────────────────────

  // Auto-records a REPAIR (or FILTER_CHANGE, if the quote looks filter-related)
  // work-history entry against the linked device whenever a service completes.
  private static async recordServiceCompletionHistory(
    deviceId: string | null,
    quoteItems: unknown,
  ): Promise<void> {
    if (!deviceId) return;
    try {
      await prisma.deviceWorkHistory.create({
        data: {
          deviceId,
          event: isFilterRelatedQuote(quoteItems) ? WorkHistoryEvent.FILTER_CHANGE : WorkHistoryEvent.REPAIR,
          eventDate: new Date(),
        },
      });
    } catch (error) {
      logger.error('Failed to record service completion history', { error, deviceId });
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

    const updated = await prisma.$transaction(async (tx) => {
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
    });

    await ComplaintService.recordServiceCompletionHistory(complaint.deviceId, complaint.quote?.items);

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

    if (requesterRole !== Role.ADMIN && complaint.userId !== requesterId) {
      throw new ApiError(403, 'Forbidden');
    }

    if (
      requesterRole !== Role.ADMIN &&
      complaint.stage !== ComplaintStage.ENTRANCE &&
      complaint.stage !== ComplaintStage.REJECTED
    ) {
      throw new ApiError(400, 'Active complaints can only be deleted by an admin');
    }

    return prisma.complaint.update({
      where: { id: complaintId },
      data:  { isDeleted: true },
    });
  }
}
