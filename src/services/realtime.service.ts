import axios from 'axios';
import { getSupabaseConfig } from '@/configs/supabase.config';
import { logger } from '@/utils/logger';

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
    try {
      await axios.post(
        `${url}/realtime/v1/api/broadcast`,
        {
          messages: [{ topic: `realtime:${channel}`, event, payload }],
        },
        {
          headers: {
            'Content-Type':  'application/json',
            Authorization:   `Bearer ${serviceRoleKey}`,
            apikey:          serviceRoleKey,
          },
          timeout: 3000, // non-blocking — FCM is the offline fallback
        },
      );
    } catch {
      // Non-fatal — FCM handles offline delivery
      logger.warn(`[Realtime] broadcast failed [channel=${channel}, event=${event}]`);
    }
  }

  // ─── Per-user / per-provider emit ─────────────────────────────────────────

  static async emitToUser(
    userId: string,
    event: string,
    payload: BroadcastPayload,
  ): Promise<void> {
    await this.broadcast(`user:${userId}`, event, payload);
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
    await this.emitToUser(userId, 'payment:verified', payload);
  }
}
