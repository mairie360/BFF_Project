import express, { Request, Response } from 'express';

type ProjectStatus = 'Active' | 'Suspended' | 'Completed' | 'Error';
type TaskStatus = 'Todo' | 'InProgress' | 'Completed' | 'Error';
type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent' | 'Error';

interface MockUser {
  id: number;
  name: string;
}

interface MockTask {
  id: number;
  title: string;
  description: string;
  due_date: string;
  priority: TaskPriority;
  status: TaskStatus;
  assigned_to: number | null;
}

interface MockProject {
  id: number;
  name: string;
  description: string;
  users: MockUser[];
  tasks: MockTask[];
}

const app = express();
app.use(express.json());

const PORT = Number(process.env.PROJECT_API_PORT ?? 4010);

const projects = new Map<number, MockProject>();
let nextProjectId = 3;
let nextTaskId = 1;

const seedUsers: MockUser[] = [
  { id: 1, name: 'Alice Martin' },
  { id: 2, name: 'Nicolas Dupont' },
  { id: 3, name: 'Sara Bernard' },
];

function seedProject(input: Omit<MockProject, 'tasks'> & { tasks?: MockTask[] }): MockProject {
  const project: MockProject = {
    ...input,
    tasks: input.tasks ?? [],
  };

  projects.set(project.id, project);
  return project;
}

function deriveProjectStatus(tasks: MockTask[]): ProjectStatus {
  if (tasks.length === 0) {
    return 'Active';
  }

  const completedCount = tasks.filter((task) => task.status === 'Completed').length;

  if (completedCount === tasks.length) {
    return 'Completed';
  }

  return 'Active';
}

function getProjectOr404(projectId: number, res: Response): MockProject | null {
  const project = projects.get(projectId);

  if (!project) {
    res.status(404).json({ message: 'Project not found' });
    return null;
  }

  return project;
}

function getTaskOr404(project: MockProject, taskId: number, res: Response): MockTask | null {
  const task = project.tasks.find((item) => item.id === taskId);

  if (!task) {
    res.status(404).json({ message: 'Task not found' });
    return null;
  }

  return task;
}

function parseId(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizePriority(value: unknown): TaskPriority {
  if (value === 'High' || value === 'Medium' || value === 'Low' || value === 'Urgent') {
    return value;
  }

  return 'Medium';
}

function normalizeTaskStatus(value: unknown): TaskStatus {
  if (value === 'Todo' || value === 'InProgress' || value === 'Completed' || value === 'Error') {
    return value;
  }

  return 'Todo';
}

function createSeedData(): void {
  seedProject({
    id: 1,
    name: 'Plateforme RH',
    description: 'Suivi des demandes internes',
    users: [...seedUsers],
    tasks: [
      {
        id: nextTaskId++,
        title: 'Créer le socle API',
        description: 'Initialiser les endpoints principaux',
        due_date: '2026-07-10T10:00:00Z',
        priority: 'High',
        status: 'InProgress',
        assigned_to: 1,
      },
      {
        id: nextTaskId++,
        title: 'Brancher le tableau de bord',
        description: 'Connecter la vue au backend',
        due_date: '2026-07-15T10:00:00Z',
        priority: 'Medium',
        status: 'Todo',
        assigned_to: 2,
      },
    ],
  });

  seedProject({
    id: 2,
    name: 'Portail support',
    description: 'Gestion des tickets support',
    users: [...seedUsers.slice(0, 2)],
    tasks: [
      {
        id: nextTaskId++,
        title: 'Préparer les filtres',
        description: 'Lister les tickets par statut',
        due_date: '2026-07-08T10:00:00Z',
        priority: 'Low',
        status: 'Completed',
        assigned_to: 2,
      },
    ],
  });
}

createSeedData();

app.get('/health', (_req: Request, res: Response) => {
  res.type('text').send('OK');
});

app.get('/v1/projects/', (_req: Request, res: Response) => {
  res.json({
    projects: [...projects.values()].map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      status: deriveProjectStatus(project.tasks),
    })),
  });
});

app.post('/v1/projects/', (req: Request, res: Response) => {
  const project: MockProject = {
    id: nextProjectId++,
    name: req.body?.name ?? 'Untitled project',
    description: req.body?.description ?? '',
    users: [...seedUsers],
    tasks: [],
  };

  projects.set(project.id, project);
  res.status(201).json({ project_id: project.id });
});

app.get('/v1/projects/:projectId/', (req: Request, res: Response) => {
  const projectId = parseId(req.params.projectId);

  if (projectId === null) {
    return res.status(400).json({ message: 'Invalid project id' });
  }

  const project = getProjectOr404(projectId, res);

  if (!project) {
    return;
  }

  res.json({
    name: project.name,
    description: project.description,
    tasks: project.tasks,
  });
});

app.patch('/v1/projects/:projectId/', (req: Request, res: Response) => {
  const projectId = parseId(req.params.projectId);

  if (projectId === null) {
    return res.status(400).json({ message: 'Invalid project id' });
  }

  const project = getProjectOr404(projectId, res);

  if (!project) {
    return;
  }

  if (typeof req.body?.name === 'string') {
    project.name = req.body.name;
  }

  if (typeof req.body?.description === 'string') {
    project.description = req.body.description;
  }

  res.json({
    name: project.name,
    description: project.description,
    tasks: project.tasks,
  });
});

app.delete('/v1/projects/:projectId/', (req: Request, res: Response) => {
  const projectId = parseId(req.params.projectId);

  if (projectId === null) {
    return res.status(400).json({ message: 'Invalid project id' });
  }

  if (!projects.delete(projectId)) {
    return res.status(404).json({ message: 'Project not found' });
  }

  return res.status(204).send();
});

app.get('/v1/projects/:projectId/tasks/', (req: Request, res: Response) => {
  const projectId = parseId(req.params.projectId);

  if (projectId === null) {
    return res.status(400).json({ message: 'Invalid project id' });
  }

  const project = getProjectOr404(projectId, res);

  if (!project) {
    return;
  }

  res.json({ tasks: project.tasks });
});

app.post('/v1/projects/:projectId/tasks/', (req: Request, res: Response) => {
  const projectId = parseId(req.params.projectId);

  if (projectId === null) {
    return res.status(400).json({ message: 'Invalid project id' });
  }

  const project = getProjectOr404(projectId, res);

  if (!project) {
    return;
  }

  const task: MockTask = {
    id: nextTaskId++,
    title: req.body?.name ?? req.body?.title ?? 'Untitled task',
    description: req.body?.description ?? '',
    due_date: req.body?.due_date ?? req.body?.dueDate ?? new Date().toISOString(),
    priority: normalizePriority(req.body?.priority),
    status: normalizeTaskStatus(req.body?.status),
    assigned_to: typeof req.body?.assigned_to === 'number' ? req.body.assigned_to : null,
  };

  project.tasks.push(task);
  res.status(201).json({
    task_id: task.id,
    name: task.title,
    description: task.description,
  });
});

app.patch('/v1/projects/:projectId/tasks/:taskId/', (req: Request, res: Response) => {
  const projectId = parseId(req.params.projectId);
  const taskId = parseId(req.params.taskId);

  if (projectId === null || taskId === null) {
    return res.status(400).json({ message: 'Invalid identifiers' });
  }

  const project = getProjectOr404(projectId, res);

  if (!project) {
    return;
  }

  const task = getTaskOr404(project, taskId, res);

  if (!task) {
    return;
  }

  if (typeof req.body?.name === 'string') {
    task.title = req.body.name;
  }

  if (typeof req.body?.title === 'string') {
    task.title = req.body.title;
  }

  if (typeof req.body?.description === 'string') {
    task.description = req.body.description;
  }

  if (typeof req.body?.due_date === 'string') {
    task.due_date = req.body.due_date;
  }

  if (typeof req.body?.dueDate === 'string') {
    task.due_date = req.body.dueDate;
  }

  if (req.body?.priority) {
    task.priority = normalizePriority(req.body.priority);
  }

  if (req.body?.status) {
    task.status = normalizeTaskStatus(req.body.status);
  }

  if (typeof req.body?.assigned_to === 'number') {
    task.assigned_to = req.body.assigned_to;
  }

  if (typeof req.body?.assignedTo === 'number') {
    task.assigned_to = req.body.assignedTo;
  }

  res.status(204).send();
});

app.delete('/v1/projects/:projectId/tasks/:taskId/', (req: Request, res: Response) => {
  const projectId = parseId(req.params.projectId);
  const taskId = parseId(req.params.taskId);

  if (projectId === null || taskId === null) {
    return res.status(400).json({ message: 'Invalid identifiers' });
  }

  const project = getProjectOr404(projectId, res);

  if (!project) {
    return;
  }

  const index = project.tasks.findIndex((task) => task.id === taskId);

  if (index === -1) {
    return res.status(404).json({ message: 'Task not found' });
  }

  project.tasks.splice(index, 1);
  return res.status(204).send();
});

app.get('/v1/projects/:projectId/users/', (req: Request, res: Response) => {
  const projectId = parseId(req.params.projectId);

  if (projectId === null) {
    return res.status(400).json({ message: 'Invalid project id' });
  }

  const project = getProjectOr404(projectId, res);

  if (!project) {
    return;
  }

  res.json({ users: project.users });
});

function addUserToProject(req: Request, res: Response): Response | void {
  const projectId = parseId(req.params.projectId);

  if (projectId === null) {
    return res.status(400).json({ message: 'Invalid project id' });
  }

  const project = getProjectOr404(projectId, res);

  if (!project) {
    return;
  }

  const userId = Number(req.body?.user_id ?? req.body?.userId ?? req.body?.id);

  if (Number.isNaN(userId)) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  if (!project.users.some((user) => user.id === userId)) {
    project.users.push({ id: userId, name: `User ${userId}` });
  }

  return res.status(204).send();
}

function removeUserFromProject(req: Request, res: Response): Response | void {
  const projectId = parseId(req.params.projectId);
  const userId = parseId(req.params.userId);

  if (projectId === null || userId === null) {
    return res.status(400).json({ message: 'Invalid identifiers' });
  }

  const project = getProjectOr404(projectId, res);

  if (!project) {
    return;
  }

  const index = project.users.findIndex((user) => user.id === userId);

  if (index === -1) {
    return res.status(404).json({ message: 'User not found' });
  }

  project.users.splice(index, 1);
  return res.status(204).send();
}

app.post('/v1/projects/:projectId/users/', addUserToProject);
app.delete('/v1/projects/:projectId/users/:userId/', removeUserFromProject);
app.delete('/v1/projects/:projectId/users/:userId//', removeUserFromProject);

export default app;

if (process.env.START_MOCK_PROJECT_API !== 'false') {
  app.listen(PORT, () => {
    console.log(`Mock Project API listening on port ${PORT}`);
  });
}