// MAIR-771: the GDPR controls of mairie360/CICD (`gdpr_contract` on CI, `gdpr_marker` and
// `gdpr_simulation` on promote-prod) only exist from CICD v4.12.0. This guard fails when a workflow
// of this repo falls behind that release, or when the workflows disagree on the version they call
// (the `uses:` ref and `cicd_version` must stay equal, since the actions are checked out at
// `cicd_version`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIN_CICD = [4, 12, 0];
const WORKFLOWS = ['cicd.yml', 'gdpr-pr.yml', 'promote-staging.yml', 'promote-prod.yml'];

const readWorkflow = (name: string): string =>
  readFileSync(join(__dirname, '..', '.github', 'workflows', name), 'utf8');

const parseVersion = (raw: string): number[] | null => {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(raw);
  return match ? match.slice(1).map(Number) : null;
};

const atLeast = (version: number[], min: number[]): boolean => {
  for (let i = 0; i < min.length; i += 1) {
    if (version[i] !== min[i]) return version[i] > min[i];
  }
  return true;
};

// Every CICD version a workflow names: the `uses:` refs (the `# vX.Y.Z` comment of a SHA pin)
// and the `cicd_version:` inputs.
const cicdVersions = (workflow: string): string[] =>
  workflow.split('\n').flatMap((raw) => {
    const line = raw.trim();
    const uses = /^uses: mairie360\/CICD\/[^@]*@([^\s#]+)\s*(?:#\s*(\S+))?/.exec(line);
    if (uses) return [uses[2] ?? uses[1]];
    const input = /^cicd_version:\s*([^\s#]+)/.exec(line);
    return input ? [input[1]] : [];
  });

describe('MAIR-771 CICD release carrying the GDPR controls', () => {
  it('every workflow calls the same CICD release, v4.12.0 or later', () => {
    const seen = WORKFLOWS.flatMap((name) => {
      const versions = cicdVersions(readWorkflow(name));
      expect({ name, calls: versions.length > 0 }).toEqual({ name, calls: true });
      return versions.map((version) => ({ name, version }));
    });
    const expected = seen[0].version;
    expect(seen.filter(({ version }) => version !== expected)).toEqual([]);
    const parsed = parseVersion(expected);
    expect(parsed).not.toBeNull();
    expect(atLeast(parsed as number[], MIN_CICD)).toBe(true);
  });

  it('CI and the prod promotion hand the AI review its key', () => {
    for (const name of ['cicd.yml', 'promote-prod.yml']) {
      const workflow = readWorkflow(name);
      expect({ name, passesKey: /secrets: inherit|ANTHROPIC_API_KEY:/.test(workflow) }).toEqual({
        name,
        passesKey: true,
      });
    }
  });

  it('the parser rejects what is not a release and reads SHA pins from their comment', () => {
    expect(parseVersion('v5.2.2')).toEqual([5, 2, 2]);
    expect(atLeast(parseVersion('v4.4.3') as number[], MIN_CICD)).toBe(false);
    expect(atLeast(parseVersion('v4.12.0') as number[], MIN_CICD)).toBe(true);
    expect(parseVersion('main')).toBeNull();
    expect(
      cicdVersions(
        '    uses: mairie360/CICD/.github/workflows/x.yml@0123abc # v5.2.2\n      cicd_version: v5.2.2  # note',
      ),
    ).toEqual(['v5.2.2', 'v5.2.2']);
  });
});
