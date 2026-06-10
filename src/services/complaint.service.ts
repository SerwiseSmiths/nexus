import { ComplaintStage, NotificationType, Prisma, QuoteStatus, Role } from '@prisma/client';
import { randomUUID } from 'crypto';
import prisma from '@/services/prisma.service';
import { ApiError } from '@/utils/apiResponse';
import { RealtimeService } from '@/services/realtime.service';
import { NotificationService } from '@/services/notification.service';
import type {
  CreateComplaintInput,
  UpdateStageInput,
  AssignProviderInput,
  AddQuoteInput,
  RespondToQuoteInput,
  LinkDeviceInput,
  ValidateQrInput,
  ReopenComplaintInput,
} from '@/types/complaint.types';

// ---------------------------------------------------------------------------
// Shared include — used across all queries for consistent shape
// ---------------------------------------------------------------------------

const COMPLAINT_INCLUDE = {
  user: {
    select: { id: true, firstName: true, lastName: true, phoneNo: true, avatar: true },
  },
  provider: {
    select: { id: true, firstName: true, lastName: true, phoneNo: true, avatar: true },
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
  [ComplaintStage.APPROVAL]:    [ComplaintStage.PAYMENT, ComplaintStage.ESTIMATION],
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
  fn().catch(() => {});
}

// ---------------------------------------------------------------------------
// ComplaintService
// ---------------------------------------------------------------------------

export class ComplaintService {
  // ─── Create ───────────────────────────────────────────────────────────────

  static async createComplaint({
    userId,
    title,
    notes,
    addressId,
    deviceId,
    deviceKey,
  }: CreateComplaintInput): Promise<ComplaintWithRelations> {
    const address = await prisma.address.findFirst({
      where: { id: addressId, userId, isDeleted: false },
    });
    if (!address) throw new ApiError(404, 'Address not found');

    if (deviceId) {
      const device = await prisma.device.findFirst({
        where: { id: deviceId, userId, isDeleted: false },
      });
      if (!device) throw new ApiError(404, 'Device not found');
    }

    const complaint = await prisma.complaint.create({
      data: {
        userId,
        title,
        notes:     notes ?? null,
        addressId,
        deviceId:  deviceId ?? null,
        deviceKey: deviceKey ?? null,
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

    return complaint;
  }

  // ─── Auto-assign ──────────────────────────────────────────────────────────

  static async autoAssignProvider(complaintId: string, excludeIds: string[]): Promise<void> {
    // Find providers with fewest active (non-closed) complaints, excluding already-rejected ones
    const providers = await prisma.user.findMany({
      where: {
        role:      Role.PROVIDER,
        isActive:  true,
        isDeleted: false,
        id: excludeIds.length > 0 ? { notIn: excludeIds } : undefined,
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

    if (providers.length === 0) return;

    // Pick provider with fewest active complaints (basic load balancing)
    const best = providers.reduce((a, b) =>
      a._count.complaintsAsProvider <= b._count.complaintsAsProvider ? a : b,
    );

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

  static async respondToQuote({ complaintId, userId, approved, rejectionReason }: RespondToQuoteInput) {
    const complaint = await prisma.complaint.findFirst({
      where:   { id: complaintId, userId, isDeleted: false },
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

      return updatedComplaint;
    } else {
      // Rejected — send back to ESTIMATION for provider to revise
      const [updatedComplaint] = await prisma.$transaction([
        prisma.complaint.update({
          where: { id: complaintId },
          data:  { stage: ComplaintStage.ESTIMATION },
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
            ? `Customer rejected the quote: "${rejectionReason}". Please revise.`
            : 'Customer rejected the quote. Please revise and resubmit.',
          type:        NotificationType.COMPLAINT,
          complaintId,
        }),
      );

      return updatedComplaint;
    }
  }

  // ─── Link Device ──────────────────────────────────────────────────────────

  static async linkDevice({ complaintId, userId, deviceId, deviceKey }: LinkDeviceInput) {
    const complaint = await prisma.complaint.findFirst({
      where: { id: complaintId, userId, isDeleted: false },
    });
    if (!complaint) throw new ApiError(404, 'Complaint not found');

    const device = await prisma.device.findFirst({
      where: { id: deviceId, userId, isDeleted: false },
    });
    if (!device) throw new ApiError(404, 'Device not found');

    return prisma.complaint.update({
      where: { id: complaintId },
      data: {
        deviceId,
        deviceKey: deviceKey ?? device.deviceKey,
      },
      include: COMPLAINT_INCLUDE,
    });
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
    title,
    notes,
    addressId,
  }: ReopenComplaintInput): Promise<ComplaintWithRelations> {
    const original = await prisma.complaint.findFirst({
      where: { id: complaintId, userId, isDeleted: false },
    });
    if (!original) throw new ApiError(404, 'Complaint not found');

    if (
      original.stage !== ComplaintStage.COMPLETED &&
      original.stage !== ComplaintStage.REJECTED
    ) {
      throw new ApiError(400, 'Only completed or rejected complaints can be reopened');
    }

    const newComplaint = await prisma.complaint.create({
      data: {
        userId,
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
        userId,
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
