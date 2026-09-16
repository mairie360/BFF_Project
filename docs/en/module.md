# BFF_Project — Module overview

[Technical documentation](technical.md) · [Français](../fr/module.md) · [README](../../README.md)

Prepare projects, tasks and collaboration information for tracking municipal work. The BFF builds responses for list, table and Kanban views using the session’s permissions.

## Audience and value

Staff assigned to tasks, project managers and administrators of the municipal workspace.

Business domain: Projects and tasks.

## Available capabilities

- Paginated project page with summary, members, filters and Kanban columns.
- Create, edit, duplicate, close and delete projects; manage tasks and their statuses.
- Task details, comments, history and role-dependent permissions.

## Typical workflow

1. Resolve the session with BFF User and load `/projects-page`.
2. Open a project to inspect tasks and allowed actions.
3. Perform a mutation, consume the returned data and reload the relevant context.

## Role within Mairie360

Associated repositories: [Projects_Web_Service](https://github.com/mairie360/Projects_Web_Service).

This repository contains the BFF server and its contract. Associated web services own the screens; the BFF adapts data and server rules needed by those screens.

## Data and current state

The module reads and writes everything through APIs: Project API for projects, tasks, membership and collaboration (comments and history), Core API for the directory of assignable people, BFF User for the caller session. The BFF has no database of its own.

## Scope and limitations

Disabling SQL access changes capabilities and persistence; that mode does not validate a full deployment. Public identifiers and statuses are normalized by helpers, while some project fields are derived from tasks.

## Developing or operating this module

The [technical guide](technical.md) covers architecture, configuration, routes, session handling, persistence, tests and CI/CD. It describes sources of truth and contract synchronization with associated repositories.
