import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The Renovate auto-approval is the reusable workflow of mairie360/CICD, which approves a Renovate
// pull request only while Renovate alone wrote and pushed its branch: this repository only calls
// it, with the same release on both pins and no permission beyond `pull-requests: write`.
const text = readFileSync(join(__dirname, '..', '.github/workflows/auto-approve.yml'), 'utf8');
const live = text.split('\n').map((line) => line.split(' #')[0].trimEnd());

describe('MAIR-685 Renovate auto-approval', () => {
  it('calls the reusable workflow of mairie360/CICD with the same cicd_version', () => {
    const uses = live.flatMap((line) => /^\s*uses:\s*(\S+)$/.exec(line)?.[1] ?? []);
    expect(uses).toHaveLength(1);
    const tag = /^mairie360\/CICD\/\.github\/workflows\/auto-approve\.yml@(v\d+\.\d+\.\d+)$/.exec(uses[0])?.[1];
    expect(tag).toBeDefined();
    expect(live.map((line) => line.trim())).toContain(`cicd_version: ${tag}`);
    expect(live.some((line) => /^\s*steps:/.test(line))).toBe(false);
  });

  it('only grants pull-requests: write', () => {
    expect(live).toContain('permissions: {}');
    const scopes = live.map((line) => line.trim()).filter((line) => /^[a-z-]+: (read|write)$/.test(line));
    expect(scopes).toEqual(['pull-requests: write']);
  });

  it('runs on every push to the branch', () => {
    expect(live.map((line) => line.trim())).toContain('types: [opened, reopened, synchronize]');
  });
});
