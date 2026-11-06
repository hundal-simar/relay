import express from 'express';
import { AppError } from './errors/AppError';
import type { Request, Response, NextFunction } from 'express';
import jobsRouter from './routes/jobs';
import {metricsRouter} from './routes/metrics';
import {healthRouter} from './routes/health';
import {schedulesRouter} from './routes/schedules';
import {queuesRouter} from './routes/queues';
import { demoRouter } from './routes/demo';
import cors from 'cors';
import { apiLimiter, requireApiKey, } from './middleware/security';
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { logger } from "./logger";
import { config } from "./config";

const app = express();

app.use(express.json());

app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers["x-request-id"];
      const id = (typeof incoming === "string" && incoming.slice(0, 64)) || randomUUID();
      res.setHeader("x-request-id", id);
      return id;
    },
    autoLogging: { ignore: (req) => (req.url ?? "").endsWith("/health") },
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
);

app.use(cors({ origin: config.DASHBOARD_ORIGIN ?? "http://localhost:5173" }));

app.set("trust proxy", 1);
app.use(apiLimiter);
app.use('/api',demoRouter);
app.use(requireApiKey);

app.use('/api', healthRouter);
app.use('/api', jobsRouter);
app.use('/api', metricsRouter);
app.use('/api', schedulesRouter);
app.use('/api', queuesRouter);



function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, error: err.message });
  }
  req.log.error({ err }, "unhandled error");
  res.status(500).json({ success: false, error: "Internal server error", requestId: req.id });
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