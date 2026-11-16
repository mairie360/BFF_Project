// MAIR-998: the compose stacks run the upstream images (database, APIs, other BFFs) of the stage
// under test instead of pinned versions: `ghcr.io/mairie360/<name>:${UPSTREAM_TAG:-dev}`, which
// mairie360/CICD sets to `dev` (PRs, main), `staging` (promote-staging gates) or `latest`
// (promote-prod gates). Nothing has to be re-pinned when an upstream releases. This guard fails
// when a compose file pins an upstream again; the BFF's own image and the template placeholder
// `service_name` are left out, like commented lines.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OWN_IMAGE = 'bff-project';
const STAGE_TAG = '${UPSTREAM_TAG:-dev}';
const ROOT = join(__dirname, '..');

const composeFiles = (): string[] =>
  readdirSync(ROOT).filter((name) => /^docker-compose.*\.ya?ml$/.test(name)).sort();

// `name:tag` of every upstream ghcr.io/mairie360 image of a compose file (empty tag when missing).
export const upstreamImages = (content: string): Array<{ name: string; tag: string }> =>
  content.split('\n').flatMap((line) => {
    if (line.trimStart().startsWith('#')) return [];
    return [...line.matchAll(/ghcr\.io\/mairie360\/([a-z0-9][a-z0-9._-]*)(?::(\$\{[^}]*\}|[^\s"'}@]+))?/g)]
      .map((match) => ({ name: match[1], tag: match[2] ?? '' }))
      .filter(({ name }) => name !== OWN_IMAGE && name !== 'service_name');
  });

describe('MAIR-998 upstream images follow the stage tag', () => {
  test('every compose file runs its upstreams on ${UPSTREAM_TAG:-dev}', () => {
    const pinned = composeFiles().flatMap((file) =>
      upstreamImages(readFileSync(join(ROOT, file), 'utf8'))
        .filter(({ tag }) => tag !== STAGE_TAG)
        .map(({ name, tag }) => `${file}: ${name}:${tag}`),
    );
    expect(pinned).toEqual([]);
  });

  test('a pinned, untagged or nested image is seen, a comment or the own image is not', () => {
    const compose = [
      'image: ${DB_IMAGE:-ghcr.io/mairie360/database:${UPSTREAM_TAG:-dev}}',
      'image: ghcr.io/mairie360/core-api:2.3.0',
      'image: ghcr.io/mairie360/project-api',
      '# image: ghcr.io/mairie360/calendar-api:1.0.0',
      `image: ghcr.io/mairie360/${OWN_IMAGE}:dev-abc1234`,
    ].join('\n');
    expect(upstreamImages(compose)).toEqual([
      { name: 'database', tag: STAGE_TAG },
      { name: 'core-api', tag: '2.3.0' },
      { name: 'project-api', tag: '' },
    ]);
  });
});
