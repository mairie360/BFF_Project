import { Router, type Request, type Response } from 'express';
import { ApiError, CloseProjectBody, ProjectDetailsResponse, ProjectIdParams, registry } from '../../openapi-registry';
import {
  buildProjectDtoForUser,
  buildTaskDtoForUser,
  fetchProjectBundle,
  handleUnknownError,
  parsePublicId,
  patchProjectOnApi,
  sendValidationError,
} from './project_helpers';
import { requireProjectManagement } from './project_access';
import { isProjectDatabaseAccessEnabled, setProjectClosed } from '../../repositories/projectRepository';

const router = Router();

registry.registerPath({
  method: 'patch',
  path: '/projects/{projectId}/close',
  tags: ['Projects'],
  summary: 'Clôture ou suspend un projet',
  request: {
    params: ProjectIdParams,
    body: { required: true, content: { 'application/json': { schema: CloseProjectBody } } },
  },
  responses: {
    200: { description: 'Projet clôturé ou suspendu', content: { 'application/json': { schema: ProjectDetailsResponse } } },
    403: { description: 'Droits insuffisants', content: { 'application/json': { schema: ApiError } } },
  },
});

router.patch('/:projectId/close', async (req: Request, res: Response) => {
  const paramsResult = ProjectIdParams.safeParse(req.params);
  const bodyResult = CloseProjectBody.safeParse(req.body);
  if (!paramsResult.success) return sendValidationError(res, paramsResult.error.issues);
  if (!bodyResult.success) return sendValidationError(res, bodyResult.error.issues);

  const projectId = parsePublicId(paramsResult.data.projectId);
  if (projectId === null) return sendValidationError(res, [{ code: 'invalid_format', path: ['projectId'], message: 'Identifiant projet invalide' }]);

  try {
    const user = await requireProjectManagement(res, projectId);
    if (!user) return;
    const databaseStatus = bodyResult.data.status === 'done' ? 'completed' : 'suspended';

    if (isProjectDatabaseAccessEnabled()) {
      await setProjectClosed(projectId, databaseStatus);
    } else {
      await patchProjectOnApi(projectId, { status: databaseStatus });
    }

    const bundle = await fetchProjectBundle(projectId);
    const baseProject = await buildProjectDtoForUser(user, bundle.project, bundle.tasks, bundle.users);
    return res.status(200).json({
      project: {
        ...baseProject,
        status: bodyResult.data.status,
        statusLabel: bodyResult.data.status === 'done' ? 'Terminé' : 'En revue',
      },
      taskItems: await Promise.all(bundle.tasks.map((task) =>
        buildTaskDtoForUser(user, projectId, task, bundle.users),
      )),
    });
  } catch (error) {
    return handleUnknownError(res, error);
  }
});

export default router;
