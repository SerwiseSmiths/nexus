import { Router } from 'express';
import healthRoutes from './healthRoutes';
import authRoutes from './auth.route';
import meRoutes from './me.route';
import addressRoutes from './address.route';
import geocodeRoutes from './geocode.route';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/me', meRoutes);
router.use('/address', addressRoutes);  // autocomplete (no auth)
router.use('/geocode', geocodeRoutes);

export default router;
