import { Router } from 'express';
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

export default router;
