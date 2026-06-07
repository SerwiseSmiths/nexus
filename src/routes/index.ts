import { Router, type Request, type Response } from 'express';
import healthRoutes from './healthRoutes';
import authRoutes from './auth.route';
import meRoutes from './me.route';
import addressRoutes from './address.route';
import geocodeRoutes from './geocode.route';
import deviceRoutes from './device.route';
import complaintRoutes from './complaint.route';
import notificationRoutes from './notification.route';
import walletRoutes from './wallet.route';
import partsRoutes from './parts.route';
import deviceTypesRoutes from './device-types.route';
import paymentRoutes from './payment.route';
import subscriptionRoutes from './subscription.route';
import { RealtimeService } from '@/services/realtime.service';
import { getSupabaseConfig } from '@/configs/supabase.config';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/me', meRoutes);
router.use('/address', addressRoutes);        // autocomplete (no auth)
router.use('/geocode', geocodeRoutes);
router.use('/device', deviceRoutes);
router.use('/complaint', complaintRoutes);
router.use('/notification', notificationRoutes);
router.use('/wallet', walletRoutes);
router.use('/parts', partsRoutes);
router.use('/device-types', deviceTypesRoutes);
router.use('/payments', paymentRoutes);
router.use('/subscription', subscriptionRoutes);

// ─── Dev-only: test Supabase broadcast ───────────────────────────────────────
// POST /api/debug/broadcast  { userId, event?, payload? }
// Fires a payment:verified broadcast so you can verify the Supabase connection
// without waiting for a real Razorpay webhook.
if (process.env.NODE_ENV !== 'production') {
  router.post('/debug/broadcast', async (req: Request, res: Response) => {
    const { userId, event = 'payment:verified', payload = { debug: true, amount: 100 } } = req.body ?? {};
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const { url } = getSupabaseConfig();
    await RealtimeService.emitToUser(userId, event, payload);

    return res.json({ ok: true, supabaseUrl: url, channel: `user:${userId}`, event, payload });
  });
}

export default router;
