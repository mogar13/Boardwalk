import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE RULES RELEASE CANNOT GO STALE OR RUN OUT OF ORDER.
 *
 * `.github/workflows/rules.yml` closes CLAUDE.md's oldest named gap — `database.rules.json` was
 * deployed by hand, so the file in this repo could stop matching production while reading like the
 * truth. A workflow is the fix, and a workflow has its own version of that same defect: it is a
 * pile of strings that nothing typechecks, and the ways it fails are all SILENT.
 *
 * Three of them, each with a real mechanism:
 *
 *  1. **The trigger stops matching.** The job is `paths`-filtered so it does not run on every push.
 *     Rename the ruleset (or repoint `firebase.json` at a different file) and the filter goes stale:
 *     the rules change lands on main, no run is queued, nothing is red, and production silently
 *     keeps the old ruleset — which is EXACTLY the state this workflow was written to end. So the
 *     expected path is read out of `firebase.json` rather than written here twice.
 *  2. **The order inverts.** `rules:test` must run before the release. A workflow that deploys
 *     first and tests after is strictly worse than the manual process it replaces, because it
 *     publishes an unproven ruleset automatically with nobody watching.
 *  3. **The release stops being gated.** The deploy step is skipped (loudly) when the credentials
 *     are unset, so merging the workflow does not red-X main before the secret exists. Drop the
 *     gate and every push to a repo without the secret fails on the security boundary.
 *
 * The workflow is deliberately in its own `paths` list — api.yml's convention — so a change that
 * disables the guard is checked by the guard. That is asserted here too, because the self-reference
 * is the one line whose absence has no other symptom at all.
 */

const ROOT = join(__dirname, '..');
const WORKFLOW_PATH = '.github/workflows/rules.yml';

const workflow = readFileSync(join(ROOT, WORKFLOW_PATH), 'utf8');
const firebaseJson = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8')) as {
  database?: { rules?: string };
};

describe('the rules release workflow', () => {
  it('deploys the ruleset firebase.json actually names, and that file is on disk', () => {
    const rulesFile = firebaseJson.database?.rules;
    // If this is undefined the CLI has nothing to deploy and the whole job is theatre.
    expect(rulesFile).toBeTruthy();
    expect(existsSync(join(ROOT, rulesFile ?? ''))).toBe(true);
  });

  it('triggers on a change to that ruleset — read from firebase.json, never restated here', () => {
    // THE STALE-TRIGGER CASE. Repoint firebase.json at `rules/database.json` and this goes red;
    // without it the rename is invisible and the release simply stops happening.
    const rulesFile = firebaseJson.database?.rules ?? '';
    expect(workflow).toContain(`'${rulesFile}'`);
  });

  it('is in its own paths filter, so a change disabling the guard is checked by it', () => {
    expect(workflow).toContain(`'${WORKFLOW_PATH}'`);
  });

  it('runs on push to main, not only by hand', () => {
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
  });

  it('TESTS the ruleset before releasing it', () => {
    const test = workflow.indexOf('npm run rules:test');
    const deploy = workflow.indexOf('firebase deploy --only database');
    expect(test).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(-1);
    // Ordering, not mere presence: a job that releases first and tests after is worse than manual.
    expect(test).toBeLessThan(deploy);
  });

  it('gates the release on the credentials being present rather than failing without them', () => {
    // The deploy step must carry an `if:` keyed to the credential check. Without it, every push in
    // a repo that has not set the secret fails — on the security boundary, which is the one place
    // a red X trains people to ignore red Xs.
    const deploy = workflow.indexOf('firebase deploy --only database');
    const step = workflow.lastIndexOf('- name:', deploy);
    expect(workflow.slice(step, deploy)).toContain("steps.creds.outputs.configured == 'true'");
  });

  it('never releases from a pull request', () => {
    // The credential check is what the release is gated on, so guarding IT guards the deploy.
    const creds = workflow.indexOf('id: creds');
    expect(creds).toBeGreaterThan(-1);
    const nextStep = workflow.indexOf('- name:', creds);
    expect(workflow.slice(creds, nextStep)).toContain("github.event_name != 'pull_request'");
  });

  it('authenticates with a service account and never a long-lived CI token', () => {
    // `FIREBASE_TOKEN` is the deprecated path and is a bearer credential with no scoping at all.
    expect(workflow).toContain('GOOGLE_APPLICATION_CREDENTIALS');
    expect(workflow).not.toContain('FIREBASE_TOKEN');
  });
});
