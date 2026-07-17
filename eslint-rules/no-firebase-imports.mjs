import { dirname, resolve, relative, sep } from 'node:path';

/**
 * Firebase is reachable from exactly one directory. Everything else talks to repo
 * interfaces.
 *
 * WHY THIS IS THE RULE PHASE 2 OWES. ARCHITECTURE.md's stack table keeps Firebase and
 * rejects VS-Dashboard's Express+SQLite, because realtime sync is the one thing this
 * app genuinely needs. That is a good bet, and this rule is the hedge on it: if the
 * economy ever has to become server-authoritative (BACKEND_PLAN.md), the work is
 * rewriting the modules under `src/system/repo/firebase/` and wiring a different
 * object into `src/system/repo/index.ts`. Not touching a single game. That property
 * is only true for as long as nothing else in `src/` can see Firebase — and "nothing
 * else imports it" is not a thing you can know by reading, only by enforcing.
 *
 * v1 is the counterexample. Firebase config was pasted inline into 32 HTML files, and
 * every game then polled `setInterval(() => window.db, 50)` to find out when the SDK
 * had loaded. There was no boundary to cross because there was no boundary. The same
 * 20-line `listenToRoom()` ended up copy-pasted into 27 games, and 22 of them leaked
 * the listener — a defect that is *unspellable* here, because a game cannot import
 * `onValue` in the first place.
 *
 * TWO BANS, because one of them alone is theatre:
 *
 *   A. `firebase/*` — the SDK itself. Only inside `src/system/repo/firebase/`.
 *      This is the rule CLAUDE.md states.
 *
 *   B. `@/system/repo/firebase/*` — the IMPLEMENTATION. Only from `src/system/repo/`,
 *      which is where the composition root lives. Without this, a game may not spell
 *      `onValue` but may still spell `firebaseProfileRepo`, and it is coupled to
 *      Firebase just as hard through a nicer-looking door. Ban A protects the SDK;
 *      ban B protects the seam. CLAUDE.md's "everything else talks to repo
 *      interfaces" needs both, and only says the first out loud.
 *
 * SCOPE: files under `src/`. Outside it there is no boundary to defend — `vite.config.ts`
 * imports the pure config reader to fail the build on missing credentials, and `tests/`
 * has to reach the implementation in order to test it. Neither ships to a browser.
 * Scoping the rule to the tree it governs is what keeps it from needing an
 * `eslint-disable`, and an `eslint-disable` also hides the times a rule was right.
 *
 * WHY THIS IS A LOCAL RULE AND NOT `no-restricted-imports`. It looked like four lines
 * of config, and it is a trap. `no-restricted-imports` is ALREADY configured in
 * eslint.config.mjs for the `../../**` ban, and ESLint replaces a rule's options
 * wholesale rather than merging them — so the directory exemption this needs
 * (`{ files: ['src/system/repo/firebase/**'], rules: { 'no-restricted-imports': 'off' } }`)
 * would silently switch the alias ban off in the one directory doing the most import
 * plumbing. That is the same "a spread replaces, it does not merge" failure that
 * shipped no-raw-palette enforcing nothing in Phase 1, wearing a config file as a
 * costume. A rule with its own name cannot collide with another rule's options, and
 * it carries its own exemption path so no override exists to get this wrong.
 */

/** The one directory that may import the Firebase SDK. */
const SDK_DIR = 'src/system/repo/firebase';

/**
 * The one directory that may import the implementation. Deliberately the PARENT of
 * SDK_DIR: `src/system/repo/index.ts` is the composition root — the single file that
 * picks which implementation of the interfaces the app gets, and therefore the single
 * file that has to name it.
 */
const IMPL_IMPORTER_DIR = 'src/system/repo';

/** The tree this rule governs. Outside it, see SCOPE above. */
const GOVERNED_DIR = 'src';

/** `firebase`, `firebase/database`, `@firebase/app` — the SDK by any of its names. */
const SDK_SPECIFIER = /^(?:firebase|@firebase)(?:\/|$)/;

const SDK_MSG =
  "'{{source}}' is the Firebase SDK. It may only be imported inside " +
  `${SDK_DIR}/ — everything else talks to the repo interfaces in src/system/repo/types.ts. ` +
  'This is what keeps a server-authoritative backend a wiring change instead of a rewrite, and it is why no game ' +
  "can leak a listener the way 22 of v1's 25 did: a game cannot spell onValue.";

const IMPL_MSG =
  "'{{source}}' is the Firebase IMPLEMENTATION of a repo. Import the interface from '@/system/repo' instead. " +
  `Only ${IMPL_IMPORTER_DIR}/ may name a concrete repo, because that is the composition root — if a game imports ` +
  'firebaseProfileRepo directly it is welded to Firebase just as hard as if it imported the SDK, only through a ' +
  'nicer-looking door.';

const toPosix = (p) => p.split(sep).join('/');

/** `a/b` is inside `a`, and inside `a/b`. It is NOT inside `a/bc`. */
const isInside = (path, base) => path === base || path.startsWith(`${base}/`);

/**
 * Where a specifier points, as a repo-relative posix path — or null for a bare
 * package, which has no path.
 *
 * Both spellings resolve, and both must: `@/system/repo/firebase/authRepo` is the
 * sanctioned one, and a relative escape is the one someone reaches for when the
 * sanctioned one is an error. Resolving properly rather than pattern-matching the
 * string is what makes `'./repo/firebase'` from `src/system/` fire — a regex looking
 * for `system/repo/firebase` reads that as clean, because from where it is standing
 * it is.
 */
function targetOf(specifier, fileDir, cwd) {
  if (specifier.startsWith('@/')) return `${GOVERNED_DIR}/${specifier.slice(2)}`;
  if (specifier.startsWith('.')) return toPosix(relative(cwd, resolve(fileDir, specifier)));
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep the Firebase SDK and its repo implementations behind src/system/repo/firebase.',
    },
    schema: [],
    messages: { sdk: SDK_MSG, impl: IMPL_MSG },
  },

  create(context) {
    const filename = context.filename;
    const fileDir = dirname(filename);
    const relDir = toPosix(relative(context.cwd, fileDir));

    // Outside `src/`, or above the repo root entirely (`..`) — not our business.
    if (relDir.startsWith('..') || !isInside(relDir, GOVERNED_DIR)) return {};

    const mayImportSdk = isInside(relDir, SDK_DIR);
    const mayImportImpl = isInside(relDir, IMPL_IMPORTER_DIR);

    /** @param {import('estree').Node} node @param {string} source */
    function check(node, source) {
      if (SDK_SPECIFIER.test(source)) {
        if (!mayImportSdk) context.report({ node, messageId: 'sdk', data: { source } });
        return;
      }
      const target = targetOf(source, fileDir, context.cwd);
      if (target !== null && isInside(target, SDK_DIR) && !mayImportImpl) {
        context.report({ node, messageId: 'impl', data: { source } });
      }
    }

    /**
     * Every syntax that pulls a module in, not just `import x from`. `export * from`
     * is an import with a re-export stapled to it, and `await import()` is the one
     * someone reaches for precisely because it does not look like an import — which
     * is the whole reason it is listed. A rule that only knows one of the four is a
     * rule with three doors open, reporting success.
     */
    const fromSource = (node) => {
      const src = node.source;
      if (src && src.type === 'Literal' && typeof src.value === 'string') check(src, src.value);
    };

    return {
      ImportDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      ImportExpression(node) {
        if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
          check(node.source, node.source.value);
        }
      },
    };
  },
};
