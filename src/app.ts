const express = require('express');
import { AppError } from './errors/AppError';
import type { Request, Response, NextFunction } from 'express';
import jobsRouter from './routes/jobs';
import {metricsRouter} from './routes/metrics';
import {healthRouter} from './routes/health';
import {schedulesRouter} from './routes/schedules';
import {queuesRouter} from './routes/queues';
import cors from 'cors';

const app = express();

app.use(express.json());

app.use(cors({ origin: process.env.DASHBOARD_ORIGIN ?? "http://localhost:5173" }));

app.use('/api', healthRouter);
app.use('/api', jobsRouter);
app.use('/api', metricsRouter);
app.use('/api', schedulesRouter);
app.use('/api', queuesRouter);



function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  const statusCode = (err instanceof AppError) ? err.statusCode : 500;
  res.status(statusCode).json({
    error: {
      message: (err instanceof AppError) ? err.message : 'Internal Server Error',
      statusCode: statusCode,
    },
  });
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface dummyBody {
  message: string;
}



app.post('/dummy', (req: Request<{},{}, dummyBody>, res: Response) => {
  const response: ApiResponse<dummyBody> = {
    success: true,
    data: req.body,
  };
  if (!response.success) {
    throw new AppError(400, 'Bad Request');
  }
  res.status(200).json(response);
});

app.use(errorHandler);

export default app;