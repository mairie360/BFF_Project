import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, DeletedProjectIdParams, ErrorResponse } from '../../openapi-registry';
import { parseRequest } from '@mairie360/bffs-lib';
import { deleteProjectOnApi, requireProjectIdParam } from './project_helpers';
import { requireProjectManagement } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import { callerOf } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'delete',
    path: '/projects/{projectId}',
    tags: ['Projects'],
    summary: 'Supprime un projet existant',

    request: {
        params: DeletedProjectIdParams,
    },

    responses: {
        ...apiErrorResponses(...ERROR_STATUSES),
        204: {
            description: 'Projet supprimé avec succès',
        },

        404: {
            description: 'Project not found',
            content: {
                'application/json': {
                    schema: ErrorResponse,
                },
            },
        },
    },
});

router.delete('/:projectId', async (req: Request, res: Response) => {
    const params = parseRequest(DeletedProjectIdParams, req.params, 'params');
    const projectId = requireProjectIdParam(params.projectId);
    const caller = callerOf(req, ERROR_STATUSES);

    await requireProjectManagement(caller, getProjectUserContext(res), projectId);
    await deleteProjectOnApi(caller, projectId);
    res.status(204).send();
});

export default router;
