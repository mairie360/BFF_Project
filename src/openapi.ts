import 'dotenv/config';
import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registry } from './openapi-registry';
import './routes/health';
import './routes/check_apis';
import './routes/Project/close_project';
import './routes/Project/create_project';
import './routes/Project/create_task';
import './routes/Project/delete_project';
import './routes/Project/delete_task';
import './routes/Project/duplicate_project';
import './routes/Project/modify_project';
import './routes/Project/modify_task';
import './routes/Project/modify_task_status';
import './routes/Project/project_details';
import './routes/Project/projects_page';
import './routes/Project/task_collaboration';

// Runtime documentation and exported clients use the same mounted routes.
export const openApiDocument = new OpenApiGeneratorV31(registry.definitions).generateDocument({
  openapi: '3.1.0',
  info: { title: 'BFF Project API', version: '1.0.0' },
});
