-- Minimal seed for the isolated test stacks (performance / security) of BFF Project.
-- The test JWTs reference two users:
--   * sub = "1": Admin role. docker-compose-security.yml injects a static token for it
--     through the ZAP replacer, so every operation is scanned authenticated;
--   * sub = "2": User role only. load-test.js signs a token for it on the fly.
-- The other rows are scan fixtures: ZAP fills path parameters with the contract examples, so
-- project-1 (with task-1) is read and updated, and project-2 and task-2 are the examples of the
-- DELETE routes. User 1 owns them and is their responsible / assignee (`user-1` in the examples).

INSERT INTO users (id, first_name, last_name, email, password, status)
VALUES
    (1, 'Security', 'Admin', 'security-admin@mairie360.fr', 'dummy', 'active'),
    (2, 'Perf', 'Tester', 'perf-tester@mairie360.fr', 'dummy', 'active')
ON CONFLICT (id) DO NOTHING;

-- Core API >= 1.1.1 requires at least one role on the user for GET /user/me
-- (otherwise Core panics with "index out of bounds" -> 502 on BFF User then BFF Project).
-- Core returns a single role: user 1 must only hold Admin.
DELETE FROM user_roles
WHERE user_id = 1 AND role_id <> (SELECT id FROM roles WHERE lower(name) = 'admin');

INSERT INTO user_roles (user_id, role_id)
SELECT 1, r.id FROM roles r WHERE lower(r.name) = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT 2, r.id FROM roles r WHERE lower(r.name) = 'user'
ON CONFLICT DO NOTHING;

INSERT INTO projects (id, title, description, owner_id, responsible_id)
VALUES
    (1, 'Scan project', 'Project read and updated by the ZAP scan', 1, 1),
    (2, 'Scan deleted project', 'Project deleted by the ZAP scan', 1, 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_members (project_id, user_id)
VALUES (1, 1), (1, 2), (2, 1)
ON CONFLICT DO NOTHING;

INSERT INTO tasks (id, project_id, title, assigned_to)
VALUES
    (1, 1, 'Scan task', 1),
    (2, 1, 'Scan deleted task', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_assignees (task_id, user_id)
VALUES (1, 1), (2, 1)
ON CONFLICT DO NOTHING;

-- Explicit ids do not advance the sequences: move them past the seeded rows so that the
-- rows created during the tests (users, projects, tasks) do not collide.
SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT max(id) FROM users));
SELECT setval(pg_get_serial_sequence('projects', 'id'), (SELECT max(id) FROM projects));
SELECT setval(pg_get_serial_sequence('tasks', 'id'), (SELECT max(id) FROM tasks));
