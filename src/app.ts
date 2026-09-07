import { openApiDocument as swaggerSpec } from './openapi';
import express from 'express';
import swaggerUi from 'swagger-ui-express';
import dotenv from 'dotenv';
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
import { requireBearerToken, tokenContextMiddleware } from './auth/token';
import { projectUserContextMiddleware } from './auth/project-user';

dotenv.config();


const app = express();
app.use(express.json());
app.use(tokenContextMiddleware);


app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get(['/openapi.json', '/swagger.json'], (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

app.use('/health', healthRouter);
app.use('/check_apis', checkApis);
app.use(['/projects-page', '/projects'], requireBearerToken);
app.use(['/projects-page', '/projects'], projectUserContextMiddleware);
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

export default app;
