import { HttpError } from '@mairie360/bffs-lib';
import { isDueDate, toBackendDueDate } from '../src/routes/Project/due_date';
import {
  collectMembers, deriveProjectDueDate, deriveProjectProgress, mapPeople, mapPerson, mapProjectCreateBodyToBackend,
  mapProjectStatus, mapTaskPriority, mapTaskStatus, mapTaskUpdateBodyToBackend, parseProjectId, statusIdToBackend,
} from '../src/routes/Project/project_helpers';
import {
  parseStatusId, parseTemplateId, requireStatusIdParam, requireTemplateIdParam, requireTemplateManagement,
} from '../src/routes/Project/status_helpers';

// MAIR-241: the fallback and refusal branches of the pure helpers (unknown upstream value, malformed or oversized id,
// absent optional field) that the route tests never reach, so the 80 % branch threshold holds on its own.
describe('MAIR-241 branch coverage of the Project helpers', () => {
  describe('ids', () => {
    test.each([undefined, '', 'status-', 'task-1', 'status-99999999999999999999'])('parseStatusId(%p) names no status', (value) => {
      expect(parseStatusId(value)).toBeNull();
    });

    test.each([undefined, 'status-1', 'template-99999999999999999999'])('parseTemplateId(%p) names no template', (value) => {
      expect(parseTemplateId(value)).toBeNull();
    });

    test('parseProjectId refuses an id beyond the safe integers and accepts a plain one', () => {
      expect(parseProjectId('project-99999999999999999999')).toBeNull();
      expect(parseProjectId('project-12')).toBe(12);
    });

    test('a path id of the wrong shape is a 404 before any upstream call', () => {
      expect(() => requireStatusIdParam('nope')).toThrow(expect.objectContaining({ status: 404 }));
      expect(() => requireTemplateIdParam('nope')).toThrow(expect.objectContaining({ status: 404 }));
      expect(requireStatusIdParam('status-4')).toBe(4);
      expect(requireTemplateIdParam('template-5')).toBe(5);
    });

    test('statusIdToBackend sends nothing without a statusId and refuses a malformed one', () => {
      expect(statusIdToBackend(undefined)).toEqual({});
      expect(statusIdToBackend('status-3')).toEqual({ status_id: 3 });
      expect(() => statusIdToBackend('3')).toThrow(HttpError);
    });
  });

  describe('roles', () => {
    test.each(['Admin', 'Responsable'])('%s manages the templates', (role) => {
      expect(() => requireTemplateManagement({ role } as never)).not.toThrow();
    });

    test('an agent does not manage the templates', () => {
      expect(() => requireTemplateManagement({ role: 'Agent' } as never)).toThrow(expect.objectContaining({ status: 403 }));
    });
  });

  describe('upstream values', () => {
    test('an unknown project, task status or priority falls back to the safe default', () => {
      expect(mapProjectStatus('Nonsense')).toBe('todo');
      expect(mapTaskStatus('Nonsense')).toBe('todo');
      expect(mapTaskPriority('Nonsense')).toBe('medium');
    });

    test('mapPeople maps a missing list to nobody', () => {
      expect(mapPeople(undefined)).toEqual([]);
      expect(mapPeople(null)).toEqual([]);
    });

    test('mapPerson names a user without a name after the fallback, and a missing user after the fallbacks', () => {
      expect(mapPerson({ id: 7 } as never, 'user-0', 'Fallback')).toMatchObject({ id: 'user-7', name: 'Fallback' });
      expect(mapPerson(null, 'project-2', 'Rénovation')).toEqual({ id: 'project-2', name: 'Rénovation', avatarUrl: null });
    });

    test('collectMembers lists a member once even when several projects share them', () => {
      const alice = { id: 1, name: 'Alice' } as never;
      const marie = { id: 2, name: 'Marie' } as never;
      expect(collectMembers([[alice, marie], [alice]]).map((member) => member.value)).toEqual(['user-1', 'user-2']);
    });
  });

  describe('progress and due date', () => {
    test('a project without task has no progress and a project of archived tasks only is done', () => {
      expect(deriveProjectProgress([])).toBe(0);
      expect(deriveProjectProgress([], 4)).toBe(100);
    });

    test('the due date of a project is its earliest dated task, undated tasks last, now when none is dated', () => {
      const dated = { status: 'Todo', due_date: '2026-11-05T00:00:00Z' } as never;
      const undated = { status: 'Todo', due_date: null } as never;
      expect(deriveProjectDueDate([undated, dated])).toBe('2026-11-05T00:00:00Z');
      expect(Number.isNaN(Date.parse(deriveProjectDueDate([undated, undated])))).toBe(false);
      expect(Number.isNaN(Date.parse(deriveProjectDueDate([])))).toBe(false);
    });
  });

  describe('request mapping', () => {
    test('an update without any field sends an empty patch, so no upstream call is needed', () => {
      expect(mapTaskUpdateBodyToBackend({})).toEqual({});
    });

    test('an update maps every field it carries', () => {
      expect(mapTaskUpdateBodyToBackend({
        title: 'Ponçage', status: 'done', priority: 'high', statusId: 'status-9', responsibleId: 'user-3', dueDate: '2026-11-05',
      } as never)).toEqual({
        name: 'Ponçage', status: 'Completed', priority: 'High', status_id: 9, assigned_to: 3, due_date: '2026-11-05T00:00:00.000Z',
      });
    });

    test('an empty due date in an update changes nothing', () => {
      expect(mapTaskUpdateBodyToBackend({ dueDate: '' } as never)).toEqual({});
    });

    test('a project is created without status, priority nor template when none is chosen', () => {
      expect(mapProjectCreateBodyToBackend({ title: 'P', description: 'D' } as never)).toEqual({ name: 'P', description: 'D' });
    });

    test('a project is created with the status, priority and template it names, and refuses a malformed template', () => {
      expect(mapProjectCreateBodyToBackend({
        title: 'P', description: 'D', status: 'done', priority: 'high', templateId: 'template-2',
      } as never)).toEqual({ name: 'P', description: 'D', status: 'Completed', priority: 'High', template_id: 2 });
      expect(() => mapProjectCreateBodyToBackend({ title: 'P', description: 'D', templateId: '2' } as never)).toThrow(HttpError);
    });
  });

  describe('due dates', () => {
    test('a date-time the calendar does not know is refused', () => {
      expect(isDueDate('2026-13-45T99:99:99Z')).toBe(false);
      expect(toBackendDueDate('2026-13-45T99:99:99Z')).toBeNull();
      expect(toBackendDueDate('')).toBeNull();
    });
  });
});
