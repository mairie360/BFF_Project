import { Router, Request, Response } from 'express';
import { parseRequest } from '@mairie360/bffs-lib';
import {
    apiErrorResponses,
    type ApiErrorStatus,
    registry,
    CreateProjectTemplateBody,
    DeletedProjectTemplateParams,
    ProjectTemplate,
    ProjectTemplateParams,
    ProjectTemplates,
    UpdateProjectTemplateBody,
} from '../../openapi-registry';
import {
    createTemplateOnApi,
    deleteTemplateOnApi,
    getTemplateFromApi,
    listTemplates,
    mapProjectTemplate,
    requireTemplateIdParam,
    requireTemplateManagement,
    updateTemplateOnApi,
} from './status_helpers';
import { getProjectUserContext } from '../../auth/project-user';
import { callerOf } from '../../services/projectData';

// Project templates (MAIR-566): their statuses (and custom fields) are copied into a project created from them, so
// editing a template never changes an existing project. Every user reads them to pick one; only the Responsable and
// Admin roles create, change or delete them. The default template cannot be deleted (Project API's 409).

const router = Router();

const READ_STATUSES = [400, 401, 404, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];
const WRITE_STATUSES = [400, 401, 403, 404, 409, 500, 502, 503] as const satisfies readonly ApiErrorStatus[];

const templateResponse = (description: string) => ({
    description,
    content: { 'application/json': { schema: ProjectTemplate } },
});

registry.registerPath({
    method: 'get',
    path: '/project-templates',
    tags: ['Templates'],
    summary: 'Lists the project templates',
    description: 'Templates a project can be created from (`templateId` of `POST /projects`), the default one included.',
    responses: {
        ...apiErrorResponses(...READ_STATUSES),
        200: { description: 'The templates', content: { 'application/json': { schema: ProjectTemplates } } },
    },
});

router.get('/', async (req: Request, res: Response) => {
    const caller = callerOf(req, READ_STATUSES);
    const templates = await listTemplates(caller);
    res.status(200).json({ templates: templates.map(mapProjectTemplate) });
});

registry.registerPath({
    method: 'post',
    path: '/project-templates',
    tags: ['Templates'],
    summary: 'Creates a project template',
    description: 'Reserved to the Responsable and Admin roles. `statuses` are in order and hold at least one status per category (`todo`, `in-progress`, `done`). `409` when another template has the name.',
    request: { body: { required: true, content: { 'application/json': { schema: CreateProjectTemplateBody } } } },
    responses: { ...apiErrorResponses(...WRITE_STATUSES), 201: templateResponse('Template created, as re-read from Project API') },
});

router.post('/', async (req: Request, res: Response) => {
    const body = parseRequest(CreateProjectTemplateBody, req.body, 'body');
    requireTemplateManagement(getProjectUserContext(res));
    const caller = callerOf(req, WRITE_STATUSES);

    const templateId = await createTemplateOnApi(caller, body);
    res.status(201).json(mapProjectTemplate(await getTemplateFromApi(caller, templateId)));
});

registry.registerPath({
    method: 'patch',
    path: '/project-templates/{templateId}',
    tags: ['Templates'],
    summary: 'Updates a project template',
    description: 'Reserved to the Responsable and Admin roles; an absent field is left unchanged and `statuses` replaces the whole list. The projects already created from the template keep their statuses.',
    request: {
        params: ProjectTemplateParams,
        body: { required: true, content: { 'application/json': { schema: UpdateProjectTemplateBody } } },
    },
    responses: { ...apiErrorResponses(...WRITE_STATUSES), 200: templateResponse('Template updated, as re-read from Project API') },
});

router.patch('/:templateId', async (req: Request, res: Response) => {
    const params = parseRequest(ProjectTemplateParams, req.params, 'params');
    const body = parseRequest(UpdateProjectTemplateBody, req.body, 'body');
    const templateId = requireTemplateIdParam(params.templateId);
    requireTemplateManagement(getProjectUserContext(res));
    const caller = callerOf(req, WRITE_STATUSES);

    await updateTemplateOnApi(caller, templateId, body);
    res.status(200).json(mapProjectTemplate(await getTemplateFromApi(caller, templateId)));
});

registry.registerPath({
    method: 'delete',
    path: '/project-templates/{templateId}',
    tags: ['Templates'],
    summary: 'Deletes a project template',
    description: 'Reserved to the Responsable and Admin roles. The projects created from it keep their statuses; the default template cannot be deleted (`409`).',
    request: { params: DeletedProjectTemplateParams },
    responses: { ...apiErrorResponses(...WRITE_STATUSES), 204: { description: 'Template deleted. Empty body.' } },
});

router.delete('/:templateId', async (req: Request, res: Response) => {
    const params = parseRequest(ProjectTemplateParams, req.params, 'params');
    const templateId = requireTemplateIdParam(params.templateId);
    requireTemplateManagement(getProjectUserContext(res));
    const caller = callerOf(req, WRITE_STATUSES);

    await deleteTemplateOnApi(caller, templateId);
    res.status(204).end();
});

export default router;
