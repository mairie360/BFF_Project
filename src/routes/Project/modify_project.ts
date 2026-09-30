import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectIdParams, UpdateProjectBody, ProjectDetailsResponse, ErrorResponse } from '../../openapi-registry';
import {
    buildProjectResponseOverridesFromUpdateBody,
    buildProjectDtoForUser,
    buildTaskDtoForUser,
    fetchProjectBundle,
    handleUnknownError,
    parsePublicId,
    sendValidationError,
    syncProjectUsersOnApi,
} from './project_helpers';
import { requireAssignableUsers, requireProjectManagement } from './project_access';
import { updateProjectRecord } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; sendRouteError answers 502 for any other upstream 4xx.
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502] as const satisfies readonly ApiErrorStatus[];

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
        ...apiErrorResponses(...ERROR_STATUSES),
        200: {
            description: 'Projet mis à jour avec succès',
            content: {
                'application/json': {
                    schema: ProjectDetailsResponse,
                },
            },
        },

        400: {
            description: 'Validation error',
            content: {
                'application/json': {
                    schema: ErrorResponse,
                },
            },
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

router.patch('/:projectId', async (req: Request, res: Response) => {
    const paramsResult = ProjectIdParams.safeParse(req.params);
    const bodyResult = UpdateProjectBody.safeParse(req.body);

    if (!paramsResult.success) {
        return sendValidationError(res, 'params', paramsResult.error.issues);
    }

    if (!bodyResult.success) {
        return sendValidationError(res, 'body', bodyResult.error.issues);
    }

    const projectId = parsePublicId(paramsResult.data.projectId);

    if (projectId === null) {
        return sendValidationError(res, 'params', [
            {
                path: ['projectId'],
                message: 'projectId must end with a numeric identifier',
            },
        ]);
    }

    try {
        const user = await requireProjectManagement(res, projectId);
        if (!user) return;
        const requestedUserIds = [
            ...(bodyResult.data.responsibleId ? [bodyResult.data.responsibleId] : []),
            ...(bodyResult.data.assigneeIds ?? []),
        ];
        if (!await requireAssignableUsers(res, user, requestedUserIds)) return;
        await updateProjectRecord(projectId, bodyResult.data);

        const desiredUserIds = requestedUserIds;
        if (desiredUserIds.length > 0) {
            await syncProjectUsersOnApi(projectId, desiredUserIds);
        }

        const bundle = await fetchProjectBundle(projectId);
        const baseProject = await buildProjectDtoForUser(user, bundle.project, bundle.tasks, bundle.users);

        return res.status(200).json({
            project: {
                ...baseProject,
                ...buildProjectResponseOverridesFromUpdateBody(bodyResult.data),
                permissions: baseProject.permissions,
            },
            taskItems: await Promise.all(bundle.tasks.map((task) =>
                buildTaskDtoForUser(user, projectId, task, bundle.users),
            )),
        });
    } catch (error) {
        return handleUnknownError(res, error, ERROR_STATUSES);
    }
});

export default router;
