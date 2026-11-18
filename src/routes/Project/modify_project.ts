import { Router, Request, Response } from 'express';
import { HttpError } from '@mairie360/bffs-lib';
import { apiErrorResponses, type ApiErrorStatus, registry, ProjectIdParams, UpdateProjectBody, ProjectDetailsResponse, ErrorResponse } from '../../openapi-registry';
import { parseRequest } from '@mairie360/bffs-lib';
import {
    addProjectUsersOnApi,
    buildProjectDtoForUser,
    buildTaskDtoForUser,
    mapPriorityToBackend,
    mapProjectStatusToBackend,
    parseGroupIdField,
    requireProjectIdParam,
    syncProjectUsersOnApi,
    userPublicId,
} from './project_helpers';
import { requireAssignableUsers, requireProjectManagement } from './project_access';
import { getProjectUserContext } from '../../auth/project-user';
import { callerOf, getProjectBundle, updateProjectRecord } from '../../services/projectData';

const router = Router();

// Error statuses of the contract; any other upstream status becomes a 502 (callUpstream).
const ERROR_STATUSES = [400, 401, 403, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

registry.registerPath({
    method: 'patch',
    path: '/projects/{projectId}',
    tags: ['Projects'],
    summary: 'Partially update a project',
    description: 'Only the sent fields change. Members are rewritten only when `assigneeIds` is sent (the current responsible is kept unless `responsibleId` is sent); a `responsibleId` alone adds that member. `status` and `priority` are stored (MAIR-558); `groupId` changes the group of the project and `null` removes it (`404` for a group the caller may not link); `labels`, `dueDate` and `taskItems` are accepted but not persisted by Project API: the response is the re-read state. A caller who saw the project only through the group they remove no longer sees it: the update is saved and the answer is `204` without a body.',

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

        204: {
            description: 'Project updated, but the caller removed the group through which they saw it: they no longer see the project',
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
            description: 'Project not found, or a group the caller may not link',
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

    const updateRecord = async () => {
        if (
            body.title !== undefined || body.description !== undefined || body.status !== undefined
            || body.priority !== undefined || body.groupId !== undefined
        ) {
            await updateProjectRecord(caller, projectId, {
                groupId: body.groupId === undefined || body.groupId === null ? body.groupId : parseGroupIdField(body.groupId),
                title: body.title,
                description: body.description,
                status: body.status === undefined ? undefined : mapProjectStatusToBackend(body.status),
                priority: body.priority === undefined ? undefined : mapPriorityToBackend(body.priority),
            });
        }
    };

    // A PATCH is partial: the membership is only rewritten when `assigneeIds` is sent, and then from
    // the merged state (the current responsible, the first member, stays unless `responsibleId` is sent).
    // A `responsibleId` alone only adds that member and removes nobody.
    const updateMembers = async () => {
        if (body.assigneeIds !== undefined) {
            const currentResponsible = current.users[0] ? userPublicId(current.users[0].id) : '';
            const responsible = body.responsibleId ?? currentResponsible;
            await syncProjectUsersOnApi(caller, projectId, [...(responsible ? [responsible] : []), ...body.assigneeIds], current.users);
        } else if (body.responsibleId) {
            await addProjectUsersOnApi(caller, projectId, [body.responsibleId], current.users);
        }
    };

    // Removing the group can take the project away from a caller who saw it only through that group:
    // the members are then written first, while the caller still sees the project.
    const removesGroup = body.groupId === null;
    if (removesGroup) {
        await updateMembers();
        await updateRecord();
    } else {
        await updateRecord();
        await updateMembers();
    }

    // Only the state Project API persisted is returned (labels and dueDate are not stored).
    const bundle = await getProjectBundle(caller, projectId);
    if (!bundle) {
        // Saved, but the caller no longer sees the project: only after removing the group it came through.
        if (removesGroup) {
            res.status(204).end();
            return;
        }
        throw new HttpError(404, 'Project not found.');
    }
    res.status(200).json({
        project: buildProjectDtoForUser(user, bundle),
        taskItems: bundle.tasks.map((task) => buildTaskDtoForUser(user, task, bundle.users)),
    });
});

export default router;
