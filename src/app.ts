import express, { Request } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from '@/configs';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from '@/configs/swagger';
import routes from '@/routes';
import { errorHandler } from '@/middlewares/errorHandler';
import { contextMiddleware } from '@/middlewares/context.middleware';

// Augment Express Request to carry raw body for webhook signature verification
declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

const app = express();

// Middlewares
app.use(helmet());
app.use(morgan('dev'));
app.use(cors({ origin: config.cors.origin }));
// Capture raw body before JSON parsing so Razorpay webhook signatures can be verified
app.use(
  express.json({
    verify: (req: Request, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(contextMiddleware);

// Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

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
