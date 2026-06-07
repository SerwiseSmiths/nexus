import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from '@/configs/supabase.config';
import { logger } from '@/utils/logger';
import { sleep } from '@/utils/sleep';

// ---------------------------------------------------------------------------
// RealtimeService
//
// Broadcasts events to Supabase Realtime channels via the Supabase JS client
// (WebSocket channel.send), matching the exact pattern apps use to receive:
//   .on('broadcast', { event: 'payment:verified' }, handler)
//
// Client apps subscribe to:
//   - channel "user:{userId}"     → customer events
//   - channel "provider:{userId}" → provider events
// ---------------------------------------------------------------------------

interface BroadcastPayload {
  [key: string]: unknown;
}

export class RealtimeService {
  private static async broadcast(
    channelName: string,
    event: string,
    payload: BroadcastPayload,
  ): Promise<void> {
    const { url, serviceRoleKey } = getSupabaseConfig();

    logger.info(`[Realtime] connecting to broadcast on channel=${channelName} event=${event}`, { supabaseUrl: url });

    const supabase = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const channel = supabase.channel(channelName);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        supabase.removeChannel(channel);
        reject(new Error(`[Realtime] broadcast timed out — channel=${channelName}`));
      }, 10_000);

      channel.subscribe((status: string, err?: Error) => {
        logger.info(`[Realtime] channel status`, { channel: channelName, status });

        if (err) {
          clearTimeout(timeout);
          supabase.removeChannel(channel);
          reject(err);
          return;
        }

        if (status === 'SUBSCRIBED') {
          channel
            .send({ type: 'broadcast', event, payload })
            .then((sendStatus) => {
              clearTimeout(timeout);
              logger.info(`[Realtime] broadcast send status`, { channel: channelName, event, sendStatus });
              supabase.removeChannel(channel);
              resolve();
            })
            .catch((sendErr: unknown) => {
              clearTimeout(timeout);
              supabase.removeChannel(channel);
              reject(sendErr);
            });
        }
      });
    });
  }

  // ─── Per-user / per-provider emit ─────────────────────────────────────────

  static async emitToUser(
    userId: string,
    event: string,
    payload: BroadcastPayload,
  ): Promise<void> {
    try {
      await this.broadcast(`user:${userId}`, event, payload);
      logger.info(`[Realtime] ✓ ${event} delivered — userId=${userId}`);
    } catch (err: any) {
      logger.error(`[Realtime] ✗ ${event} FAILED — userId=${userId}`, {
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
    logger.info(`[Realtime] payment:verified queued — userId=${userId}`);
    await sleep(10_000);

    logger.info(`[Realtime] broadcasting payment:verified — channel=user:${userId}`, { payload });
    try {
      await this.broadcast(`user:${userId}`, 'payment:verified', payload);
      logger.info(`[Realtime] ✓ payment:verified delivered — userId=${userId}`);
    } catch (err: any) {
      logger.error(`[Realtime] ✗ payment:verified FAILED — userId=${userId}`, {
        status:  err?.response?.status,
        data:    err?.response?.data ?? err?.responseData,
        message: err?.message,
      });
    }
  }
}
