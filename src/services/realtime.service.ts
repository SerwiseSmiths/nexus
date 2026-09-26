import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from '@/configs/supabase.config';
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

    console.log(`[Realtime] connecting to broadcast on channel=${channelName} event=${event}`, { supabaseUrl: url });

    const supabase = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const channel = supabase.channel(channelName);

    const disconnect = (reason: string) => {
      console.log(`[Realtime][disconnected] channel=${channelName} reason=${reason}`);
      supabase.removeChannel(channel);
    };

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        disconnect('timeout');
        reject(new Error(`[Realtime] broadcast timed out — channel=${channelName}`));
      }, 10_000);

      channel.subscribe((status: string, err?: Error) => {
        console.log(`[Realtime] channel status`, { channel: channelName, status });

        if (err) {
          clearTimeout(timeout);
          console.error(`[Realtime] channel error — channel=${channelName}`, { error: err.message });
          disconnect('error');
          reject(err);
          return;
        }

        if (status === 'SUBSCRIBED') {
          console.log(`[Realtime][connected] channel=${channelName}`);
          console.log(`[Realtime][event:emitted] channel=${channelName} event=${event}`, { payload });
          channel
            .send({ type: 'broadcast', event, payload })
            .then((sendStatus) => {
              clearTimeout(timeout);
              console.log(`[Realtime] broadcast send status`, { channel: channelName, event, sendStatus });
              disconnect('sent');
              resolve();
            })
            .catch((sendErr: unknown) => {
              clearTimeout(timeout);
              disconnect('send_failed');
              reject(sendErr);
            });
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[Realtime][disconnected] channel=${channelName} status=${status}`);
        }
      });
    });
  }

  // Whether anyone is currently subscribed to a provider's channel — radix
  // tracks presence there once its socket connects (see realtime.service.ts's
  // channel.track() call). Used to skip a redundant FCM push when the app is
  // already live and about to get the same event over the socket instead
  // (see ComplaintService.assignProvider). Fire-and-forget callers should
  // treat a timeout/error as "assume offline" — better to over-notify via FCM
  // than to silently drop the only alert the provider gets.
  static async isProviderOnline(providerId: string, timeoutMs = 3_000): Promise<boolean> {
    const channelName = `provider:${providerId}`;
    const { url, serviceRoleKey } = getSupabaseConfig();

    const supabase = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const channel = supabase.channel(channelName);

    console.log(`[Realtime] isProviderOnline — checking`, { providerId, channel: channelName });

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (online: boolean, reason: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        supabase.removeChannel(channel);
        console.log(`[Realtime] isProviderOnline — resolved`, { providerId, online, reason });
        resolve(online);
      };

      const timeout = setTimeout(() => {
        finish(false, 'timeout');
      }, timeoutMs);

      // Supabase sends the channel's current presence state as soon as this
      // subscriber syncs — we never call channel.track() ourselves, so any
      // key present here is a real client (the radix app).
      channel.on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const keys = Object.keys(state);
        console.log(`[Realtime] isProviderOnline — presence sync`, { providerId, presentKeys: keys });
        finish(keys.length > 0, keys.length > 0 ? 'presence_found' : 'presence_empty');
      });

      channel.subscribe((status: string, err?: Error) => {
        console.log(`[Realtime] isProviderOnline — subscribe status`, { providerId, status, err: err?.message });
        if (err || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          finish(false, `subscribe_${status}`);
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
      console.log(`[Realtime] ✓ ${event} delivered — userId=${userId}`);
    } catch (err: any) {
      console.error(`[Realtime] ✗ ${event} FAILED — userId=${userId}`, {
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
    try {
      await this.broadcast(`provider:${providerId}`, event, payload);
      console.log(`[Realtime] ✓ ${event} delivered — providerId=${providerId}`);
    } catch (err: any) {
      console.error(`[Realtime] ✗ ${event} FAILED — providerId=${providerId}`, {
        status:  err?.response?.status,
        data:    err?.response?.data ?? err?.responseData,
        message: err?.message,
      });
    }
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

  // notifyProvider is false when the assignment lands outside the 9am-6pm
  // business-hours window — the customer-facing event still fires, but the
  // provider's own `complaint:assigned` channel (which drives the full-screen
  // popup in radix) is held back until ComplaintService.claimPendingAssignment
  // delivers it once the provider next opens the app.
  static async emitProviderAssigned(complaint: BroadcastPayload, notifyProvider = true): Promise<void> {
    const payload = { complaint };
    await Promise.allSettled([
      this.emitToUser(complaint.userId as string, 'complaint:provider_assigned', payload),
      complaint.providerId && notifyProvider
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

  // The provider gets this too — a quote can be entered by an admin from
  // watchtower on the provider's behalf, and radix needs to see the complaint
  // move to APPROVAL without the provider having submitted anything itself.
  static async emitQuoteAdded(complaint: BroadcastPayload): Promise<void> {
    const payload = { complaint };
    await Promise.allSettled([
      this.emitToUser(complaint.userId as string, 'complaint:quote_added', payload),
      complaint.providerId
        ? this.emitToProvider(complaint.providerId as string, 'complaint:quote_added', payload)
        : Promise.resolve(),
    ]);
  }

  // Generic "this complaint changed, refetch it" signal for the assigned
  // provider — for changes that aren't a stage transition (devices linked,
  // complaint deleted, a silent out-of-hours assignment, …). Radix only
  // invalidates its caches on this; it never shows UI for it.
  static async emitComplaintUpdated(complaint: BroadcastPayload): Promise<void> {
    if (!complaint.providerId) return;
    await this.emitToProvider(complaint.providerId as string, 'complaint:updated', { complaint });
  }

  // Sent to the provider a complaint was just taken away from (admin
  // reassigned it to someone else) so it drops off their list immediately.
  static async emitProviderUnassigned(providerId: string, complaint: BroadcastPayload): Promise<void> {
    await this.emitToProvider(providerId, 'complaint:unassigned', { complaint });
  }

  // ─── Provider account events (admin edits from watchtower) ────────────────

  // Name / avatar / skills / active status changed — radix re-pulls /me/self.
  static async emitProviderProfileUpdated(providerId: string): Promise<void> {
    await this.emitToProvider(providerId, 'profile:updated', {});
  }

  // Bank account approved/edited — radix refetches its bank-details query.
  static async emitProviderBankUpdated(providerId: string): Promise<void> {
    await this.emitToProvider(providerId, 'bank:updated', {});
  }

  // Wallet credited/debited (manual adjustment or payout) — radix refetches
  // home stats, whose earnings figures are read straight off the wallet.
  static async emitProviderWalletUpdated(providerId: string): Promise<void> {
    await this.emitToProvider(providerId, 'wallet:updated', {});
  }

  // A customer's device list changed outside radix (e.g. admin added a device
  // from watchtower) — sent to every provider with an open job for that
  // customer so their appliance-select / work-history lists refresh.
  static async emitCustomerDevicesUpdated(providerIds: string[], customerId: string): Promise<void> {
    await Promise.allSettled(
      providerIds.map(id => this.emitToProvider(id, 'devices:updated', { customerId })),
    );
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
    console.log(`[Realtime] payment:verified queued — userId=${userId}`);
    await sleep(7_000);

    console.log(`[Realtime] broadcasting payment:verified — channel=user:${userId}`, { payload });
    try {
      await this.broadcast(`user:${userId}`, 'payment:verified', payload);
      console.log(`[Realtime] ✓ payment:verified delivered — userId=${userId}`);
    } catch (err: any) {
      console.error(`[Realtime] ✗ payment:verified FAILED — userId=${userId}`, {
        status:  err?.response?.status,
        data:    err?.response?.data ?? err?.responseData,
        message: err?.message,
      });
    }
  }
}
