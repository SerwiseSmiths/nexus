import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from '@/configs';
import routes from '@/routes';
import { errorHandler } from '@/middlewares/errorHandler';

const app = express();

// Middlewares
app.use(helmet());
app.use(cors({ origin: config.cors.origin }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api', routes);

// 404 Handler
app.use((_req, res) => {
  res.status(404).json({
    status: 'error',
    statusCode: 404,
    message: 'Resource not found',
  });
});

// Error Handler
app.use(errorHandler);

export default app;
