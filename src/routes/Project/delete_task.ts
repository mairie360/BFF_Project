import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, DeletedTaskParams, ErrorResponse } from '../../openapi-registry';
import { parseRequest } from '@mairie360/bffs-lib';
import { deleteTaskOnApi, requireTaskParams } from './project_helpers';
import { requireTaskManagement } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import { callerOf } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'delete',
    path: '/projects/{projectId}/tasks/{taskId}',
    tags: ['Projects'],
    summary: 'Supprime une tâche existante pour un projet',

    request: {
        params: DeletedTaskParams,
    },

    responses: {
        ...apiErrorResponses(...ERROR_STATUSES),
        204: {
            description: 'Tâche supprimée avec succès',
        },

        404: {
            description: 'Project or task not found',
            content: {
                'application/json': {
                    schema: ErrorResponse,
                },
            },
        },
    },
});

router.delete('/:projectId/tasks/:taskId', async (req: Request, res: Response) => {
    const { projectId, taskId } = requireTaskParams(parseRequest(DeletedTaskParams, req.params, 'params'));
    const caller = callerOf(req, ERROR_STATUSES);

    await requireTaskManagement(caller, getProjectUserContext(res), projectId, taskId);
    await deleteTaskOnApi(caller, projectId, taskId);
    res.status(204).send();
});

export default router;
