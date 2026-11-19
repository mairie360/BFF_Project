import type { Request } from 'express';

import { loadProjectUserContext } from '../src/auth/project-user';

const mockSessionRole = jest.fn();

jest.mock('@mairie360/bffs-lib', () => ({
  ...jest.requireActual('@mairie360/bffs-lib'),
  sessionUserId: () => 7,
  sessionRole: (...args: unknown[]) => mockSessionRole(...args),
}));

// One role rule for every BFF (the lib's): the names the database seeds, their aliases and a custom role.
describe('MAIR-689 the project role of a caller follows the lib role rule', () => {
  test.each([
    ['Admin', 'Admin'],
    ['Administrateur', 'Admin'],
    ['ROLE_ADMIN', 'Admin'],
    [' role-admin ', 'Admin'],
    ['Maire', 'Maire'],
    ['Mayor', 'Maire'],
    ['Responsable', 'Responsable'],
    ['ROLE_RESPONSABLE', 'Responsable'],
    ['Manager', 'Responsable'],
    ['User', 'User'],
    ['Employé', 'User'],
    ['Guest', 'Guest'],
    ['Stagiaire', 'Guest'],
    ['Super Admin', 'Guest'],
  ])('the role claim %p gives %p', async (claim, expected) => {
    mockSessionRole.mockReturnValue(claim);
    const context = await loadProjectUserContext({} as Request);
    expect(context.role).toBe(expected);
    expect(context.id).toBe(7);
  });
});
