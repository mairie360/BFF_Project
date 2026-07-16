import { Router, Request, Response } from 'express';
import { registry, ProjectIdParams, UpdateProjectBody, ProjectDetailsResponse, ApiError } from '../../openapi-registry';
import {
    buildProjectResponseOverridesFromUpdateBody,
    buildProjectDtoForUser,
    buildTaskDtoForUser,
    fetchProjectBundle,
    handleUnknownError,
    mapProjectUpdateBodyToBackend,
    patchProjectOnApi,
    parsePublicId,
    sendValidationError,
    syncProjectUsersOnApi,
} from './project_helpers';
import { requireAssignableUsers, requireProjectManagement } from './project_access';
import { isProjectDatabaseAccessEnabled, updateProjectRecord } from '../../repositories/projectRepository';

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
        const user = await requireProjectManagement(res, projectId);
        if (!user) return;
        const requestedUserIds = [
            ...(bodyResult.data.responsibleId ? [bodyResult.data.responsibleId] : []),
            ...(bodyResult.data.assigneeIds ?? []),
        ];
        if (!await requireAssignableUsers(res, user, requestedUserIds)) return;
        const backendPayload = mapProjectUpdateBodyToBackend(bodyResult.data);

        if (isProjectDatabaseAccessEnabled()) {
            await updateProjectRecord(projectId, bodyResult.data);
        } else if (Object.keys(backendPayload).length > 0) {
            await patchProjectOnApi(projectId, backendPayload);
        }

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
        return handleUnknownError(res, error);
    }
});

export default router;
