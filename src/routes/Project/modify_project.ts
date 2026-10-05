import { Router, Request, Response } from 'express';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectIdParams, UpdateProjectBody, ProjectDetailsResponse, ErrorResponse } from '../../openapi-registry';
import { parseRequest } from '@mairie360/bffs-lib';
import {
    addProjectUsersOnApi,
    buildProjectDtoForUser,
    buildTaskDtoForUser,
    fetchProjectBundle,
    requireProjectIdParam,
    syncProjectUsersOnApi,
    userPublicId,
} from './project_helpers';
import { requireAssignableUsers, requireProjectManagement } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import { callerOf, updateProjectRecord } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'patch',
    path: '/projects/{projectId}',
    tags: ['Projects'],
    summary: 'Partially update a project',
    description: 'Only the sent fields change. Members are rewritten only when `assigneeIds` is sent (the current responsible is kept unless `responsibleId` is sent); a `responsibleId` alone adds that member. `priority`, `labels`, `dueDate` and `taskItems` are accepted but not persisted by Project API: the response is the re-read state.',

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
            description: 'Project updated, as re-read from Project API',
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
    const params = parseRequest(ProjectIdParams, req.params, 'params');
    const body = parseRequest(UpdateProjectBody, req.body, 'body');
    const projectId = requireProjectIdParam(params.projectId);
    const caller = callerOf(req, ERROR_STATUSES);

    const { user, bundle: current } = await requireProjectManagement(caller, getProjectUserContext(res), projectId);
    await requireAssignableUsers(caller, user, [
        ...(body.responsibleId ? [body.responsibleId] : []),
        ...(body.assigneeIds ?? []),
    ]);

    if (body.title !== undefined || body.description !== undefined || body.status !== undefined) {
        await updateProjectRecord(caller, projectId, body);
    }

    // A PATCH is partial: the membership is only rewritten when `assigneeIds` is sent, and then from
    // the merged state (the current responsible, the first member, stays unless `responsibleId` is sent).
    // A `responsibleId` alone only adds that member and removes nobody.
    if (body.assigneeIds !== undefined) {
        const currentResponsible = current.users[0] ? userPublicId(current.users[0].id) : '';
        const responsible = body.responsibleId ?? currentResponsible;
        await syncProjectUsersOnApi(caller, projectId, [...(responsible ? [responsible] : []), ...body.assigneeIds], current.users);
    } else if (body.responsibleId) {
        await addProjectUsersOnApi(caller, projectId, [body.responsibleId], current.users);
    }

    // Only the state Project API persisted is returned (priority, labels and dueDate are not stored).
    const bundle = await fetchProjectBundle(caller, projectId);
    res.status(200).json({
        project: buildProjectDtoForUser(user, bundle.project, bundle.tasks, bundle.users),
        taskItems: bundle.tasks.map((task) => buildTaskDtoForUser(user, task, bundle.users)),
    });
});

export default router;
