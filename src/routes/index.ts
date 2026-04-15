import { Router } from 'express';
import healthRoutes from './healthRoutes';

const router = Router();

router.use('/health', healthRoutes);

export default router;
