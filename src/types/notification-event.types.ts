import { z } from 'zod';
import { NotificationEventType, NotificationStatus, NotificationType, Role } from '@prisma/client';

// ---------------------------------------------------------------------------
// Device-reported events
// ---------------------------------------------------------------------------

// ACCEPTED / REJECTED are written by nexus itself from the accept/reject
// endpoints (the authoritative outcome), so devices can't report them.
export const CLIENT_EVENT_TYPES = [
  NotificationEventType.DELIVERED,
  NotificationEventType.DISPLAYED,
  NotificationEventType.OPENED,
  NotificationEventType.DISMISSED,
  NotificationEventType.TIMED_OUT,
] as const;

export const CLIENT_EVENT_SOURCES = ['NATIVE', 'NOTIFEE', 'APP'] as const;

const ClientEventSchema = z.object({
  notificationId: z.string().uuid().optional(),
  complaintId:    z.string().uuid().optional(),
  event:          z.enum(CLIENT_EVENT_TYPES),
  source:         z.enum(CLIENT_EVENT_SOURCES),
  // Epoch ms or ISO string from the device clock. Clamped server-side.
  occurredAt:     z.union([z.number(), z.string()]).optional(),
  // Small flat detail bag, e.g. { cta: 'view', appState: 'background' }.
  meta:           z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
}).refine((e) => e.notificationId || e.complaintId, {
  message: 'notificationId or complaintId is required',
});

export const ReportEventsSchema = z.object({
  events: z.array(ClientEventSchema).min(1).max(50),
});

export const ReportEventsWithTokenSchema = ReportEventsSchema.extend({
  token: z.string().min(1),
});

export type ClientEventBody = z.infer<typeof ClientEventSchema>;
export type ReportEventsBody = z.infer<typeof ReportEventsSchema>;
export type ReportEventsWithTokenBody = z.infer<typeof ReportEventsWithTokenSchema>;

export interface ReportEventsInput {
  userId: string;
  events: ClientEventBody[];
  // Set for the action-token path: every event is pinned to this complaint.
  tokenComplaintId?: string;
}

export interface RecordServerEventInput {
  userId:      string;
  complaintId: string;
  event:       NotificationEventType;
  meta?:       Record<string, string>;
}

// ---------------------------------------------------------------------------
// Admin (watchtower) queries
// ---------------------------------------------------------------------------

// Where a notification ended up in the funnel — see NotificationEventService.outcomeWhere.
export const NOTIFICATION_OUTCOMES = [
  'failed',
  'no_report',
  'delivered_not_opened',
  'opened_no_action',
  'accepted',
  'rejected',
  'dismissed',
  'timed_out',
] as const;
export type NotificationOutcome = (typeof NOTIFICATION_OUTCOMES)[number];

export const AdminNotificationQuerySchema = z.object({
  search:      z.string().trim().max(100).optional(),
  userId:      z.string().uuid().optional(),
  complaintId: z.string().uuid().optional(),
  role:        z.nativeEnum(Role).optional(),
  type:        z.nativeEnum(NotificationType).optional(),
  status:      z.nativeEnum(NotificationStatus).optional(),
  outcome:     z.enum(NOTIFICATION_OUTCOMES).optional(),
  // Only pushes the device reported at least one event for.
  trackedOnly: z.enum(['true', 'false']).optional(),
  from:        z.string().optional(),
  to:          z.string().optional(),
  page:        z.coerce.number().int().min(1).default(1),
  limit:       z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminNotificationQuery = z.infer<typeof AdminNotificationQuerySchema>;

export const AdminEventQuerySchema = z.object({
  search:      z.string().trim().max(100).optional(),
  userId:      z.string().uuid().optional(),
  complaintId: z.string().uuid().optional(),
  notificationId: z.string().uuid().optional(),
  event:       z.nativeEnum(NotificationEventType).optional(),
  source:      z.enum(['NATIVE', 'NOTIFEE', 'APP', 'SERVER']).optional(),
  // Events nexus couldn't tie to a specific push (socket-only deliveries).
  unlinkedOnly: z.enum(['true', 'false']).optional(),
  from:        z.string().optional(),
  to:          z.string().optional(),
  page:        z.coerce.number().int().min(1).default(1),
  limit:       z.coerce.number().int().min(1).max(200).default(50),
});
export type AdminEventQuery = z.infer<typeof AdminEventQuerySchema>;
