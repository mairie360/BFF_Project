import { Router, Request, Response } from 'express';
import { registry, ProjectIdParams, UpdateProjectBody, ProjectDetailsResponse, ApiError } from '../../openapi-registry';
import {
    buildProjectResponseFromState,
    buildProjectResponseOverridesFromUpdateBody,
    fetchProjectBundle,
    handleUnknownError,
    mapProjectUpdateBodyToBackend,
    parsePublicId,
    // patchProjectOnApi,
    sendValidationError,
} from './project_helpers';

const router = Router();

registry.registerPath({
    method: 'patch',
    path: '/projects/{projectId}',
    tags: ['Projects'],
    summary: 'Met à jour un projet existant',

    request: {
        params: ProjectIdParams,
        body: {
            required: true,
            content: {
                'application/json': {
                    schema: UpdateProjectBody,
                },
            },
        },
    },

    responses: {
        200: {
            description: 'Projet mis à jour avec succès',
            content: {
                'application/json': {
                    schema: ProjectDetailsResponse,
                },
            },
        },

        400: {
            description: 'Erreur de validation',
            content: {
                'application/json': {
                    schema: ApiError,
                },
            },
        },
        
        404: {
            description: 'Projet introuvable',
            content: {
                'application/json': {
                    schema: ApiError,
                },
            },
        },
    },
});

router.patch('/:projectId', async (req: Request, res: Response) => {
    const paramsResult = ProjectIdParams.safeParse(req.params);
    const bodyResult = UpdateProjectBody.safeParse(req.body);

    if (!paramsResult.success) {
        return sendValidationError(res, paramsResult.error.issues);
    }

    if (!bodyResult.success) {
        return sendValidationError(res, bodyResult.error.issues);
    }

    const projectId = parsePublicId(paramsResult.data.projectId);

    if (projectId === null) {
        return sendValidationError(res, [
            {
                code: 'invalid_format',
                path: ['projectId'],
                message: 'projectId must end with a numeric identifier',
            },
        ]);
    }

    try {
        const backendPayload = mapProjectUpdateBodyToBackend(bodyResult.data);

        // if (Object.keys(backendPayload).length > 0) {
        //     await patchProjectOnApi(projectId, backendPayload);
        // }

        const bundle = await fetchProjectBundle(projectId);

        return res.status(200).json(
            buildProjectResponseFromState({
                project: bundle.project,
                tasks: bundle.tasks,
                users: bundle.users,
                override: buildProjectResponseOverridesFromUpdateBody(bodyResult.data),
            }),
        );
    } catch (error) {
        return handleUnknownError(res, error);
    }
});

export default router;