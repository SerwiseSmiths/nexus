import { Router } from 'express';
import { HealthController } from '@/controllers/HealthController';

const router = Router();

router.get('/', HealthController.getStatus);

export default router;
