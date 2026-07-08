import express from 'express';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
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

dotenv.config();


const app = express();
app.use(express.json());

app.get('/__debug', (_req, res) => {
  res.json({ from: 'express-ok' });
});


const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'BFF API',
      version: '1.0.0',
      description: 'Documentation du BFF gérant la vérification des services',
    },
    servers: [
      {
        url: `http://${process.env.HOST ?? 'localhost'}:${process.env.PORT ?? 3000}`,
        description: 'Serveur local',
      },
    ],
  },
  apis: ['./src/routes/**/*.ts'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/swagger.json', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

app.use('/health', healthRouter);
app.use('/check_apis', checkApis);
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

console.log("STACK ROUTES:");
const router = (app as unknown as {
  router?: { stack?: Array<any> };
  _router?: { stack?: Array<any> };
}).router ?? (app as unknown as { _router?: { stack?: Array<any> } })._router;

console.log(
  (router?.stack ?? [])
    .filter((l: any) => l.route)
    .map((l: any) => ({
      path: l.route.path,
      methods: l.route.methods
    }))
);



export default app;
