import { Router, type Request, type Response } from 'express';
import {
  ApiError,
  ProjectTaskParams,
  TaskCollaborationResponse,
  TaskComment,
  TaskCommentBody,
  registry,
} from '../../openapi-registry';
import { addTaskComment, getTaskCollaboration } from '../../repositories/projectRepository';
import { handleUnknownError, parsePublicId, sendValidationError } from './project_helpers';
import { requireTaskComment, requireTaskView } from './project_access';

const router = Router();

registry.registerPath({
  method: 'get',
  path: '/projects/{projectId}/tasks/{taskId}/collaboration',
  tags: ['Projects'],
  summary: 'Consulte les commentaires et l’historique d’une tâche',
  request: { params: ProjectTaskParams },
  responses: {
    200: { description: 'Suivi collaboratif', content: { 'application/json': { schema: TaskCollaborationResponse } } },
    403: { description: 'Droits insuffisants', content: { 'application/json': { schema: ApiError } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/projects/{projectId}/tasks/{taskId}/comments',
  tags: ['Projects'],
  summary: 'Ajoute un commentaire à une tâche',
  request: {
    params: ProjectTaskParams,
    body: { required: true, content: { 'application/json': { schema: TaskCommentBody } } },
  },
  responses: {
    201: { description: 'Commentaire ajouté', content: { 'application/json': { schema: TaskComment } } },
    403: { description: 'Droits insuffisants', content: { 'application/json': { schema: ApiError } } },
  },
});

function parseTaskParams(req: Request, res: Response): { projectId: number; taskId: number } | null {
  const paramsResult = ProjectTaskParams.safeParse(req.params);
  if (!paramsResult.success) {
    sendValidationError(res, paramsResult.error.issues);
    return null;
  }
  const projectId = parsePublicId(paramsResult.data.projectId);
  const taskId = parsePublicId(paramsResult.data.taskId);
  if (projectId === null || taskId === null) {
    sendValidationError(res, [{ code: 'invalid_format', path: ['projectId', 'taskId'], message: 'Identifiants invalides' }]);
    return null;
  }
  return { projectId, taskId };
}

router.get('/:projectId/tasks/:taskId/collaboration', async (req: Request, res: Response) => {
  const params = parseTaskParams(req, res);
  if (!params) return;
  try {
    const user = await requireTaskView(res, params.projectId, params.taskId);
    if (!user) return;
    return res.status(200).json(await getTaskCollaboration(params.projectId, params.taskId));
  } catch (error) {
    return handleUnknownError(res, error);
  }
});

router.post('/:projectId/tasks/:taskId/comments', async (req: Request, res: Response) => {
  const params = parseTaskParams(req, res);
  if (!params) return;
  const bodyResult = TaskCommentBody.safeParse(req.body);
  if (!bodyResult.success) return sendValidationError(res, bodyResult.error.issues);

  try {
    const user = await requireTaskComment(res, params.projectId, params.taskId);
    if (!user) return;
    return res.status(201).json(await addTaskComment(params.projectId, params.taskId, user, bodyResult.data.message));
  } catch (error) {
    return handleUnknownError(res, error);
  }
});

export default router;
