import { Router } from 'express';
import healthRoutes from './healthRoutes';
import authRoutes from './auth.route';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);

export default router;
