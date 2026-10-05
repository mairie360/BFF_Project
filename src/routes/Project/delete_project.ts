import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, DeletedProjectIdParams, ErrorResponse } from '../../openapi-registry';
import { deleteProjectOnApi, handleUnknownError, parseProjectId, sendValidationError } from './project_helpers';
import { requireProjectManagement } from './project_access';

const router = Router();

// Error statuses of the contract; sendRouteError answers 502 for any other upstream 4xx.
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
    const paramsResult = DeletedProjectIdParams.safeParse(req.params);

    if (!paramsResult.success) {
        return sendValidationError(res, 'params', paramsResult.error.issues);
    }

    const projectId = parseProjectId(paramsResult.data.projectId);

    if (projectId === null) {
        return sendValidationError(res, 'params', [
            {
                path: ['projectId'],
                message: 'projectId must be a project-<id> identifier',
            },
        ]);
    }

    try {
        if (!await requireProjectManagement(res, projectId)) return;
        await deleteProjectOnApi(projectId);
        return res.status(204).send();
    } catch (error) {
        return handleUnknownError(res, error, ERROR_STATUSES);
    }
});

export default router;
