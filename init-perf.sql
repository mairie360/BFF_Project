-- Volume seed of the BFF_Project performance stack (MAIR-474), run by the `seeder` service after
-- init-test.sql. Same data as Project_API's init-perf.sql, so that the BFF reads Project API on a real
-- volume: without it the lists hold two projects and the costs that grow with the data (visibility per
-- project, numbered pages, history and comment feeds) are never measured through the BFF.
--
-- The hot project 12 and its task 87 (rows of Project_API's init-test.sql) are created here first,
-- owned by the Admin (user 1); the history of task 87 is signed by the Admin too.

INSERT INTO projects (id, title, description, owner_id, responsible_id)
VALUES (12, 'Réfection de la place du marché', 'Travaux de voirie 2026', 1, 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (id, project_id, title, status, priority, assigned_to)
VALUES (87, 12, 'Consulter les riverains', 'in_progress', 'high', 1)
ON CONFLICT (id) DO NOTHING;

-- Explicit ids do not advance the sequences: move them past 12 and 87 before the bulk inserts.
SELECT setval(pg_get_serial_sequence('projects', 'id'), GREATEST((SELECT MAX(id) FROM projects), 1));
SELECT setval(pg_get_serial_sequence('tasks', 'id'), GREATEST((SELECT MAX(id) FROM tasks), 1));

INSERT INTO users (id, first_name, last_name, email, password, status, is_archived)
SELECT n, 'Agent', 'Perf ' || n, 'perf.agent.' || n || '@mairie360.fr',
       '$argon2id$v=19$m=19456,t=2,p=1$/iKF9PbiDRDs4EKPjlIIhg$UKx9vfwwps250mEP/bYp63CXbEnQGULeUAhDq+az9Aw',
       'active', FALSE
FROM generate_series(100001, 102000) AS n
UNION ALL
SELECT n, 'Responsable', 'Perf ' || n, 'perf.manager.' || n || '@mairie360.fr',
       '$argon2id$v=19$m=19456,t=2,p=1$/iKF9PbiDRDs4EKPjlIIhg$UKx9vfwwps250mEP/bYp63CXbEnQGULeUAhDq+az9Aw',
       'active', FALSE
FROM generate_series(103001, 103100) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT n, r.id FROM generate_series(100001, 102000) AS n CROSS JOIN roles r WHERE r.name = 'User'
UNION ALL
SELECT n, r.id FROM generate_series(103001, 103100) AS n CROSS JOIN roles r WHERE r.name = 'Responsable'
ON CONFLICT DO NOTHING;

-- Group g (0..99) is owned by Responsable 103001 + g and holds agents 100001 + 20g .. + 19.
INSERT INTO groups (owner_id, name, description)
SELECT 103001 + g, 'Perf service ' || g, 'Performance seed'
FROM generate_series(0, 99) AS g
ON CONFLICT (name) DO NOTHING;

INSERT INTO group_members (group_id, user_id)
SELECT gr.id, m.user_id
FROM generate_series(0, 99) AS g
JOIN groups gr ON gr.name = 'Perf service ' || g
CROSS JOIN LATERAL (
    SELECT 103001 + g AS user_id
    UNION ALL
    SELECT 100001 + 20 * g + i FROM generate_series(0, 19) AS i
) m
ON CONFLICT DO NOTHING;

-- Project 1000 + p is owned by agent 100001 + p % 2000, created over the last 500 days.
INSERT INTO projects (id, title, description, owner_id, created_at)
SELECT 1000 + p, 'Perf project ' || p, 'Performance seed',
       100001 + p % 2000, now() - (p % 500) * interval '1 day' - p * interval '1 second'
FROM generate_series(0, 4999) AS p
ON CONFLICT (id) DO NOTHING;

-- Its members: the next 5 agents.
INSERT INTO project_members (project_id, user_id)
SELECT 1000 + p, 100001 + (p + k) % 2000
FROM generate_series(0, 4999) AS p CROSS JOIN generate_series(1, 5) AS k
ON CONFLICT DO NOTHING;

INSERT INTO tasks (project_id, title, status, priority, assigned_to, updated_by)
SELECT 1000 + p, 'Perf task ' || t,
       (ARRAY['todo', 'in_progress', 'completed'])[1 + t % 3]::task_status,
       (ARRAY['low', 'medium', 'high'])[1 + t % 3]::task_priority,
       100001 + (p + 1) % 2000, 100001 + p % 2000
FROM generate_series(0, 4999) AS p CROSS JOIN generate_series(1, 10) AS t
WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE project_id = 1000);

-- The hot project.
INSERT INTO project_members (project_id, user_id)
SELECT 12, n FROM generate_series(100001, 100300) AS n
ON CONFLICT DO NOTHING;

-- MAIR-502: like a long-lived project, most of them are done, hence archived by the database
-- (tasks.archived_at): 200 active tasks (t % 10 = 0), 1 800 archived. Same as Project_API.
INSERT INTO tasks (project_id, title, status, priority, assigned_to, updated_by)
SELECT 12, 'Perf hot task ' || t,
       (CASE WHEN t % 10 = 0 THEN 'todo' ELSE 'completed' END)::task_status,
       'medium', 100001 + t % 300, 1
FROM generate_series(1, 2000) AS t
WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE project_id = 12 AND title = 'Perf hot task 1');

INSERT INTO task_comments (task_id, author_id, message, created_at)
SELECT 87, 100001 + c % 300, 'Perf comment ' || c, now() - c * interval '1 minute'
FROM generate_series(1, 1000) AS c
WHERE NOT EXISTS (SELECT 1 FROM task_comments WHERE task_id = 87 AND message = 'Perf comment 1');

-- 1 000 status changes of task 87, logged by fn_log_task_change like real writes.
DO $$
BEGIN
    IF (SELECT count(*) FROM task_history WHERE task_id = 87) < 1000 THEN
        FOR i IN 1..1000 LOOP
            UPDATE tasks
            SET status = (ARRAY['todo', 'in_progress', 'review', 'completed'])[1 + i % 4]::task_status,
                updated_by = 1
            WHERE id = 87;
        END LOOP;
    END IF;
END $$;

SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT MAX(id) FROM users), 1));
SELECT setval(pg_get_serial_sequence('projects', 'id'), GREATEST((SELECT MAX(id) FROM projects), 1));
SELECT setval(pg_get_serial_sequence('tasks', 'id'), GREATEST((SELECT MAX(id) FROM tasks), 1));

ANALYZE users;
ANALYZE user_roles;
ANALYZE groups;
ANALYZE group_members;
ANALYZE projects;
ANALYZE project_members;
ANALYZE tasks;
ANALYZE task_comments;
ANALYZE task_history;
