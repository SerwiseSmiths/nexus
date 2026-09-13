import { ComplaintService } from '@/services/complaint.service';
import { logger } from '@/utils/logger';

// Catches job assignments that were deferred because they landed outside
// business hours (9am-6pm IST) and whose provider never opened the app to
// claim the popup before the deadline — see
// ComplaintService.reassignExpiredPendingAssignments.
const SWEEP_INTERVAL_MS = 5 * 60 * 1_000;
let _sweepId: ReturnType<typeof setInterval> | null = null;

export const startAssignmentDeadlineSweep = (): void => {
  if (_sweepId !== null) return;

  _sweepId = setInterval(() => {
    ComplaintService.reassignExpiredPendingAssignments().catch((err) =>
      logger.error('[Complaint] Assignment deadline sweep failed:', err),
    );
  }, SWEEP_INTERVAL_MS);
};
