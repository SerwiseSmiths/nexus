import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '@/middlewares/auth.middleware';
import { ComplaintService } from '@/services/complaint.service';
import { NotificationEventService } from '@/services/notification-event.service';
import { ApiError, ApiResponse } from '@/utils/apiResponse';
import { describeZodError } from '@/utils/zodError';
import {
  AdminEventQuerySchema,
  AdminNotificationQuerySchema,
  ReportEventsSchema,
  ReportEventsWithTokenSchema,
} from '@/types/notification-event.types';

// Native code may replay queued reports long after the 15-minute action-token
// expiry (phone offline, app killed) — accept them for a day.
const TOKEN_REPORT_MAX_AGE_SEC = 24 * 60 * 60;

export class NotificationEventController {
  static async reportEvents(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = ReportEventsSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, describeZodError(parsed.error), parsed.error.issues);

      const result = await NotificationEventService.reportEvents({
        userId: req.user!.id,
        events: parsed.data.events,
      });
      return ApiResponse.success(res, 200, 'Events recorded', result);
    } catch (error) {
      next(error);
    }
  }

  // No session: authenticated by the job-assignment action token, which pins
  // both the provider and the complaint.
  static async reportEventsWithToken(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = ReportEventsWithTokenSchema.safeParse(req.body);
      if (!parsed.success) throw new ApiError(400, describeZodError(parsed.error), parsed.error.issues);

      const { complaintId, providerId } = ComplaintService.verifyAssignmentActionTokenForTracking(
        parsed.data.token,
        TOKEN_REPORT_MAX_AGE_SEC,
      );
      const result = await NotificationEventService.reportEvents({
        userId:           providerId,
        events:           parsed.data.events,
        tokenComplaintId: complaintId,
      });
      return ApiResponse.success(res, 200, 'Events recorded', result);
    } catch (error) {
      next(error);
    }
  }

  static async listNotifications(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = AdminNotificationQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new ApiError(400, describeZodError(parsed.error), parsed.error.issues);

      const result = await NotificationEventService.listNotifications(parsed.data);
      return ApiResponse.success(res, 200, 'Notifications fetched', result);
    } catch (error) {
      next(error);
    }
  }

  static async listEvents(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const parsed = AdminEventQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new ApiError(400, describeZodError(parsed.error), parsed.error.issues);

      const result = await NotificationEventService.listEvents(parsed.data);
      return ApiResponse.success(res, 200, 'Notification events fetched', result);
    } catch (error) {
      next(error);
    }
  }
}
