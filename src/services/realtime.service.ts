import axios from 'axios';
import { getSupabaseConfig } from '@/configs/supabase.config';
import { logger } from '@/utils/logger';
import { sleep } from '@/utils/sleep';

// ---------------------------------------------------------------------------
// RealtimeService
//
// Broadcasts events to Supabase Realtime channels via the REST broadcast API.
// This is stateless and Vercel-serverless-safe — no persistent WebSocket is kept.
//
// Client apps should subscribe to:
//   - channel "user:{userId}"     → customer events
//   - channel "provider:{userId}" → provider events
// ---------------------------------------------------------------------------

interface BroadcastPayload {
  [key: string]: unknown;
}

export class RealtimeService {
  private static async broadcast(
    channel: string,
    event: string,
    payload: BroadcastPayload,
  ): Promise<void> {
    const { url, serviceRoleKey } = getSupabaseConfig();
    const broadcastUrl = `${url}/realtime/v1/api/broadcast`;

    const res = await axios.post(
      broadcastUrl,
      {
        messages: [{ topic: `realtime:${channel}`, event, payload }],
      },
      {
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${serviceRoleKey}`,
          apikey:          serviceRoleKey,
        },
        timeout: 5000,
      },
    );

    if (res.status < 200 || res.status >= 300) {
      throw Object.assign(new Error(`Supabase returned ${res.status}`), { responseData: res.data });
    }
  }

  // ─── Per-user / per-provider emit ─────────────────────────────────────────

  static async emitToUser(
    userId: string,
    event: string,
    payload: BroadcastPayload,
  ): Promise<void> {
    try {
      await this.broadcast(`user:${userId}`, event, payload);
      logger.info(`[Realtime] ✓ sent to user`, { userId, event });
    } catch (err: any) {
      logger.error(`[Realtime] ✗ failed for user`, {
        userId,
        event,
        status:  err?.response?.status,
        data:    err?.response?.data ?? err?.responseData,
        message: err?.message,
      });
    }
  }

  static async emitToProvider(
    providerId: string,
    event: string,
    payload: BroadcastPayload,
  ): Promise<void> {
    await this.broadcast(`provider:${providerId}`, event, payload);
  }

  // ─── Complaint-specific events ────────────────────────────────────────────

  static async emitComplaintCreated(complaint: BroadcastPayload): Promise<void> {
    const payload = { complaint };
    await Promise.allSettled([
      this.emitToUser(complaint.userId as string, 'complaint:created', payload),
      complaint.providerId
        ? this.emitToProvider(complaint.providerId as string, 'complaint:created', payload)
        : Promise.resolve(),
    ]);
  }

  static async emitStageChanged(
    complaint: BroadcastPayload,
    oldStage: string,
    newStage: string,
  ): Promise<void> {
    const payload = { complaint, oldStage, newStage };
    await Promise.allSettled([
      this.emitToUser(complaint.userId as string, 'complaint:stage_changed', payload),
      complaint.providerId
        ? this.emitToProvider(complaint.providerId as string, 'complaint:stage_changed', payload)
        : Promise.resolve(),
    ]);
  }

  static async emitProviderAssigned(complaint: BroadcastPayload): Promise<void> {
    const payload = { complaint };
    await Promise.allSettled([
      this.emitToUser(complaint.userId as string, 'complaint:provider_assigned', payload),
      complaint.providerId
        ? this.emitToProvider(complaint.providerId as string, 'complaint:assigned', payload)
        : Promise.resolve(),
    ]);
  }

  static async emitProviderAccepted(complaint: BroadcastPayload): Promise<void> {
    await this.emitToUser(
      complaint.userId as string,
      'complaint:provider_accepted',
      { complaint },
    );
  }

  static async emitProviderRejected(complaint: BroadcastPayload): Promise<void> {
    await this.emitToUser(
      complaint.userId as string,
      'complaint:provider_rejected',
      { complaint },
    );
  }

  static async emitQuoteAdded(complaint: BroadcastPayload): Promise<void> {
    await this.emitToUser(complaint.userId as string, 'complaint:quote_added', { complaint });
  }

  static async emitQuoteResponded(
    complaint: BroadcastPayload,
    approved: boolean,
  ): Promise<void> {
    if (complaint.providerId) {
      await this.emitToProvider(complaint.providerId as string, 'complaint:quote_responded', {
        complaint,
        approved,
      });
    }
  }

  static async emitQrScanRequested(
    complaint: BroadcastPayload,
    token: string,
  ): Promise<void> {
    await this.emitToUser(complaint.userId as string, 'complaint:qr_scan_requested', {
      complaint,
      token,
    });
  }

  // ─── Payment events ───────────────────────────────────────────────────────

  static async emitPaymentVerified(
    userId: string,
    payload: BroadcastPayload,
  ): Promise<void> {
    // Wait 10 s before broadcasting — gives the client time to navigate to
    // PaymentVerificationScreen and join the Supabase channel.
    logger.info('[Realtime] payment:verified queued (10s delay)', { userId });
    await sleep(10_000);

    logger.info('[Realtime] broadcasting payment:verified', { userId, payload });
    try {
      await this.broadcast(`user:${userId}`, 'payment:verified', payload);
      logger.info('[Realtime] ✓ payment:verified delivered to user', { userId });
    } catch (err: any) {
      logger.error('[Realtime] ✗ payment:verified FAILED for user', {
        userId,
        status:  err?.response?.status,
        data:    err?.response?.data ?? err?.responseData,
        message: err?.message,
      });
    }
  }
}
