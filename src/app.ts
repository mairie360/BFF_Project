import 'dotenv/config';
import { openApiDocument as swaggerSpec } from './openapi';
import {
  apiOnlyHeaders,
  errorHandler,
  noStore,
  notFoundHandler,
  parseTrustProxy,
  requireBearer,
  securityHeaders,
} from '@mairie360/bffs-lib';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import healthRouter from './routes/health';
import checkApis from './routes/check_apis';
import projectsPageRouter from './routes/Project/projects_page';
import projectDetailsRouter from './routes/Project/project_details';
import createProjectRouter from './routes/Project/create_project';
import modifyProjectRouter from './routes/Project/modify_project';
import deleteProjectRouter from './routes/Project/delete_project';
import duplicateProjectRouter from './routes/Project/duplicate_project';
import createTaskRouter from './routes/Project/create_task';
import modifyTaskRouter from './routes/Project/modify_task';
import modifyTaskStatusRouter from './routes/Project/modify_task_status';
import deleteTaskRouter from './routes/Project/delete_task';
import closeProjectRouter from './routes/Project/close_project';
import taskCollaborationRouter from './routes/Project/task_collaboration';
import { projectUserContextMiddleware } from './auth/project-user';


const app = express();
// Client IP (req.ip) behind the ingress: see parseTrustProxy.
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
// Security headers shared by every BFF on every response, /docs included; stricter API-only headers
// (default-src 'none', no embedding) everywhere else, set before body parsing so that they also cover
// body-parse errors.
app.use(securityHeaders);
app.use(apiOnlyHeaders());
app.use(express.json());


app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get(['/openapi.json', '/swagger.json'], (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

app.use('/health', healthRouter);
app.use('/check_apis', checkApis);
// Session-bound routes: never cached, 401 before any upstream call without a Bearer token, then the
// caller's session is resolved with BFF User.
app.use(['/projects-page', '/projects'], noStore, requireBearer, projectUserContextMiddleware);
app.use('/projects-page', projectsPageRouter);
app.use('/projects', projectDetailsRouter);
app.use('/projects', createProjectRouter);
app.use('/projects', modifyProjectRouter);
app.use('/projects', deleteProjectRouter);
app.use('/projects', duplicateProjectRouter);
app.use('/projects', createTaskRouter);
app.use('/projects', modifyTaskRouter);
app.use('/projects', modifyTaskStatusRouter);
app.use('/projects', deleteTaskRouter);
app.use('/projects', closeProjectRouter);
app.use('/projects', taskCollaborationRouter);

// Unknown routes and every error that reaches Express (malformed JSON, oversized body, unexpected
// errors) end in the shared envelope `{ error: { code, message, details } }` instead of Express's HTML
// page: the status is kept and an unexpected error becomes a generic 500 without leaking its message.
app.use(notFoundHandler);
app.use(errorHandler());

export default app;
