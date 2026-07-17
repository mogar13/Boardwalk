/**
 * `database.rules.json` is the enforcement boundary. This is the file that proves it.
 *
 * WHY THIS TEST IS THE MOST IMPORTANT ONE IN PHASE 2. Every other guard in this repo is
 * static — ESLint, tsc, a line counter. None of them can see a security rule, because a
 * security rule is not code that runs here; it runs on Google's servers, in a language
 * with no compiler on this machine. So a rules file has this repo's signature failure mode
 * built in: it is prose that LOOKS like enforcement, it cannot be typo-checked, and a
 * mistake in it reports success by doing nothing at all. ARCHITECTURE.md's Phase 1 lesson
 * was that only a screenshot found the `<dialog>` bug; this is the same lesson pointed at
 * the thing where being wrong is most expensive.
 *
 * v1 has no test like this. It shipped two backdoors.
 *
 * The rules are loaded FROM THE REAL FILE. A test that inlines its own copy of the rules
 * tests the copy, which is the "guard goes blind" failure landing on the guard itself —
 * exactly what Phase 0 caught in this suite's own fixtures.
 *
 * COST: boots the RTDB emulator (a JVM), so this file is slow and needs Java. It does not
 * skip when Java is absent — it fails. A security test that quietly skips is worse than no
 * security test, because the run stays green and the honest list keeps claiming it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { get, ref, set, update } from 'firebase/database';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const PORT = 9000;

/** `demo-` prefixed: the emulator then needs no credentials and refuses to touch a real project. */
const PROJECT_ID = 'demo-boardwalk';

const ME = 'uid-me';
const STRANGER = 'uid-stranger';
const ADMIN = 'uid-admin';

let emulator: ChildProcess | null = null;
let testEnv: RulesTestEnvironment;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function portOpen(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: HOST, port: PORT });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForEmulator(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen()) return;
    await sleep(250);
  }
  throw new Error(
    `The RTDB emulator never opened ${HOST}:${PORT}. It needs Java (\`java -version\`) and, on ` +
      'first run, network access to download the emulator jar. This test does not skip when the ' +
      'emulator is missing — the rules are the enforcement boundary, and a security test that ' +
      'skips leaves the suite green while proving nothing.'
  );
}

beforeAll(async () => {
  // Reuse an emulator someone already has running (`npx firebase emulators:start`), which
  // makes the edit-run loop on the rules file instant instead of a JVM boot per run.
  if (!(await portOpen())) {
    emulator = spawn(
      'npx',
      ['firebase', 'emulators:start', '--only', 'database', '--project', PROJECT_ID],
      { cwd: ROOT, stdio: 'ignore', detached: false }
    );
    await waitForEmulator(90_000);
  }

  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: {
      // THE REAL FILE. Not a copy, not a fixture.
      rules: readFileSync(join(ROOT, 'database.rules.json'), 'utf8'),
      host: HOST,
      port: PORT,
    },
  });
}, 120_000);

afterAll(async () => {
  // Both guarded: if beforeAll threw (no Java, no network for the jar), neither exists and
  // cleanup must not throw a second, less informative error on top of the real one.
  await testEnv.cleanup();
  if (emulator !== null) emulator.kill('SIGTERM');
});

afterEach(async () => {
  await testEnv.clearDatabase();
});

/**
 * The database handle a test context hands back.
 *
 * Derived from the SDK's own signature rather than imported from `firebase/database`,
 * because the two disagree: `RulesTestContext.database()` is DECLARED as the compat
 * `firebase.database.Database` while its own docblock says it returns a modular one, and
 * at runtime the modular functions work on it. Writing `Database` here instead produces a
 * type error about a missing `'type'` property that describes the SDK's typings, not
 * anything wrong with this test. `ReturnType` follows whichever they mean.
 */
type TestDb = ReturnType<RulesTestContext['database']>;

/**
 * Seed data past the rules, the way the Firebase console or a server would — never a
 * client. Every `assertFails` below would be meaningless if the setup went through the
 * same door it is asserting is locked.
 */
async function seed(fn: (db: TestDb) => Promise<void>): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await fn(ctx.database());
  });
}

const asUser = (uid: string) => testEnv.authenticatedContext(uid).database();
const asAnon = () => testEnv.unauthenticatedContext().database();
const asAdmin = () => testEnv.authenticatedContext(ADMIN).database();

/** A profile that satisfies every `.validate` in the file. The baseline the tests vary from. */
const validProfile = {
  name: 'Forerunner',
  avatar: '👤',
  bankrollCents: 500_000,
  xp: 0,
  // No `level` — it is derived from `xp`, never stored, so it is not a valid field. The
  // `$other: false` test below asserts a write that includes one is now REFUSED.
};

describe('the root denies by default', () => {
  it('refuses a read of a node nobody wrote a rule for', async () => {
    // This is what makes it safe to have left v1's chat/room rules out until Phase 5. A
    // node with no rule is CLOSED, so "not written yet" and "locked" are the same state.
    await assertFails(get(ref(asUser(ME), 'something_nobody_planned')));
  });

  it('refuses a write to a node nobody wrote a rule for', async () => {
    await assertFails(set(ref(asUser(ME), 'something_nobody_planned'), { x: 1 }));
  });

  it("refuses v1's world-writable room and chat nodes — they are NOT ported yet", async () => {
    // DEPARTURE #1 FROM v1, ASSERTED. v1's rules end with a `$room` wildcard matching
    // /(_rooms|_hands|_hand_incoming)$/ at `".read": true, ".write": true`, plus `chat` and
    // `global_chat` at `".write": true`. Porting those "unchanged" into Phase 2 would have
    // shipped three world-writable subtrees guarding nodes this app does not have. They
    // land in Phase 5, with rooms and chat, and get tightened on the way in. Until then
    // they are closed, and this is the test that says so rather than the comment.
    await assertFails(set(ref(asUser(ME), 'blackjack_rooms/room1'), { x: 1 }));
    await assertFails(set(ref(asUser(ME), 'uno_hands/room1'), { x: 1 }));
    await assertFails(set(ref(asUser(ME), 'chat/room1/messages/m1'), { text: 'hi' }));
    await assertFails(set(ref(asUser(ME), 'global_chat/m1'), { text: 'hi' }));
  });
});

describe('users/<uid> — the private record', () => {
  it('lets the owner write and read their own profile', async () => {
    await assertSucceeds(set(ref(asUser(ME), `users/${ME}/profile`), validProfile));
    await assertSucceeds(get(ref(asUser(ME), `users/${ME}/profile`)));
  });

  it('refuses a stranger, both ways', async () => {
    await seed(async (db) => {
      await set(ref(db, `users/${ME}/profile`), validProfile);
    });
    // The whole reason `leaderboard/` has to exist as a separate node: this is not
    // readable, so a public leaderboard cannot be built by reading it.
    await assertFails(get(ref(asUser(STRANGER), `users/${ME}/profile`)));
    await assertFails(set(ref(asUser(STRANGER), `users/${ME}/profile`), validProfile));
  });

  it('refuses an unauthenticated read', async () => {
    await assertFails(get(ref(asAnon(), `users/${ME}/profile`)));
  });

  it('rejects an unknown profile field — $other is false', async () => {
    // The pin. Phase 4 adding `title` here is a rules change, on purpose: the server
    // refusing an unplanned field is what stops the private record quietly growing fields
    // that the public projection then leaks.
    await assertFails(
      set(ref(asUser(ME), `users/${ME}/profile`), { ...validProfile, sneaky: 'value' })
    );
    // `level` specifically. Phase 2 stored it; Phase 3 derives it from `xp` and deletes the
    // field, and this is the server half of that decision — a write that reintroduces a
    // stored `level` is refused, so the client's derived value can never be shadowed by a
    // stale stored one. Removing `level` from the rules without this test would look like a
    // no-op; this is what makes the deletion enforced rather than merely done.
    await assertFails(set(ref(asUser(ME), `users/${ME}/profile`), { ...validProfile, level: 1 }));
  });

  it('rejects a profile field of the wrong type', async () => {
    // `bankrollCents: "5000"` is the shape of v1's actual bug — its `setMoney` did
    // `parseInt`, so a string in the money field was coerced rather than refused, and a
    // 3:2 blackjack payout silently lost the fractional chip.
    await assertFails(
      set(ref(asUser(ME), `users/${ME}/profile`), { ...validProfile, bankrollCents: '500000' })
    );
    await assertFails(
      set(ref(asUser(ME), `users/${ME}/profile`), { ...validProfile, bankrollCents: -1 })
    );
    await assertFails(set(ref(asUser(ME), `users/${ME}/profile`), { ...validProfile, xp: -1 }));
    await assertFails(set(ref(asUser(ME), `users/${ME}/profile`), { ...validProfile, name: '' }));
  });

  it('has no isDev field to forge, because v2 does not store one', async () => {
    // v1 stored `users/<uid>/profile/isDev`, self-writable, granting nothing — and it was
    // still live: chat trusted a client-asserted isDev on every message, so anyone could
    // mint themselves a dev badge. A forgeable field that grants nothing is not harmless;
    // it is a thing the next feature believes. Here it is not a field, so `$other: false`
    // refuses it, and no future reader can be tempted.
    await assertFails(
      set(ref(asUser(ME), `users/${ME}/profile`), { ...validProfile, isDev: true })
    );
  });
});

describe('usernames/ — the public index', () => {
  it('is readable by anyone, including signed-out', async () => {
    // It HAS to be: sign-in resolves a username to an account before anyone is
    // authenticated. That is why the node holds a boolean and never an address.
    await seed(async (db) => {
      await set(ref(db, 'usernames/forerunner'), { uid: ME, viaEmail: false });
    });
    await assertSucceeds(get(ref(asAnon(), 'usernames/forerunner')));
  });

  it('lets you claim an unclaimed name for yourself', async () => {
    await assertSucceeds(
      set(ref(asUser(ME), 'usernames/forerunner'), { uid: ME, viaEmail: false })
    );
  });

  it('refuses a claim that points at someone else', async () => {
    await assertFails(
      set(ref(asUser(ME), 'usernames/forerunner'), { uid: STRANGER, viaEmail: false })
    );
  });

  it("refuses overwriting someone else's claim", async () => {
    // Claim-then-verify, from v1. No transaction — the rule is the lock.
    await seed(async (db) => {
      await set(ref(db, 'usernames/forerunner'), { uid: ME, viaEmail: false });
    });
    await assertFails(
      set(ref(asUser(STRANGER), 'usernames/forerunner'), { uid: STRANGER, viaEmail: false })
    );
  });

  it('REFUSES AN EMAIL FIELD — the leak this pin exists to stop', async () => {
    // DEPARTURE #2 FROM v1, AND THE REASON FOR IT. v1 pins `leaderboard` to its exact field
    // set and does NOT pin this node — its `.validate` only requires `uid` to be present,
    // so a client could write a real address into a world-readable index and nothing would
    // refuse it. The synthetic-email design exists precisely to keep addresses out of here;
    // `$other: false` is what makes that a guarantee instead of a habit.
    await assertFails(
      set(ref(asUser(ME), 'usernames/forerunner'), {
        uid: ME,
        viaEmail: true,
        email: 'real@example.com',
      })
    );
  });

  it('requires viaEmail to be present and boolean', async () => {
    await assertFails(set(ref(asUser(ME), 'usernames/forerunner'), { uid: ME }));
    await assertFails(set(ref(asUser(ME), 'usernames/forerunner'), { uid: ME, viaEmail: 'yes' }));
  });

  it('refuses a key the client-side USERNAME_RE would also refuse', async () => {
    // The rules and src/system/auth/credentials.ts pin the same shape. The rule is the
    // enforcement; the client check is the courtesy that stops a user meeting it as a
    // permission error. This is the assertion that catches them drifting apart.
    await assertFails(set(ref(asUser(ME), 'usernames/UPPER'), { uid: ME, viaEmail: false }));
    await assertFails(set(ref(asUser(ME), 'usernames/has-dash'), { uid: ME, viaEmail: false }));
    await assertFails(set(ref(asUser(ME), 'usernames/a'), { uid: ME, viaEmail: false }));
  });

  it('cannot even ADDRESS a key with a dot — RTDB forbids it below the rules', () => {
    // Worth recording rather than asserting through a write: `.`, `#`, `$`, `[` and `]` are
    // illegal in an RTDB key at the SDK level, so `usernames/has.dot` throws in the client
    // before a rule is consulted. The first draft of this test asserted `assertFails` on it
    // and went red — not because the rules let it through, but because the write never
    // happened. A test whose failure mode is "the thing under test was never reached" is
    // the one that passes for the wrong reason later, so it is written as the SDK-level
    // fact it actually is.
    expect(() => ref(asUser(ME), 'usernames/has.dot')).toThrow();
  });

  it('refuses an unauthenticated claim', async () => {
    await assertFails(set(ref(asAnon(), 'usernames/forerunner'), { uid: ME, viaEmail: false }));
  });
});

describe('leaderboard/<uid> — the public projection', () => {
  it('is readable by anyone', async () => {
    await seed(async (db) => {
      await set(ref(db, `leaderboard/${ME}`), validProfile);
    });
    await assertSucceeds(get(ref(asAnon(), `leaderboard/${ME}`)));
  });

  it('lets the owner write their own row', async () => {
    await assertSucceeds(set(ref(asUser(ME), `leaderboard/${ME}`), validProfile));
  });

  it("refuses a stranger writing someone else's row", async () => {
    await assertFails(set(ref(asUser(STRANGER), `leaderboard/${ME}`), validProfile));
  });

  it('REFUSES A SIXTH FIELD — the leak this pin exists to stop', async () => {
    // The load-bearing line in the whole file. This node is world-readable, so anything
    // that reaches it is public forever. Pinning the field set means a private field added
    // in Phase 4 CANNOT be published here by a writer who forgot this node is public — the
    // server refuses it. A projection built by spreading the profile would have shipped it.
    await assertFails(
      set(ref(asUser(ME), `leaderboard/${ME}`), { ...validProfile, email: 'real@example.com' })
    );
    await assertFails(set(ref(asUser(ME), `leaderboard/${ME}`), { ...validProfile, wins: 3 }));
  });
});

describe('admins/ — the actual privilege boundary', () => {
  it('is not writable by anyone, at any depth', async () => {
    // THE BACKDOOR TEST. v1 shipped two paths to dev rights — a hardcoded
    // `username === "forerunner" && password === "luna&abi"` in world-readable client
    // source, and a second console-reachable `authenticateDev()` — because privilege was a
    // client-side boolean. Here privilege is THIS NODE, and there is no `.write` rule at
    // any depth, so no client can grant it to anyone including themselves. Membership is
    // set from the Firebase console and nowhere else. If this test ever goes green, the
    // whole posture is gone.
    await assertFails(set(ref(asUser(ME), `admins/${ME}`), true));
    await assertFails(set(ref(asUser(ME), `admins/${STRANGER}`), true));
    await assertFails(set(ref(asAnon(), `admins/${ME}`), true));
    await assertFails(set(ref(asAdmin(), `admins/${STRANGER}`), true));
  });

  it('lets you ask whether YOU are an admin', async () => {
    await seed(async (db) => {
      await set(ref(db, `admins/${ADMIN}`), true);
    });
    await assertSucceeds(get(ref(asAdmin(), `admins/${ADMIN}`)));
  });

  it('does not let you enumerate the admin list', async () => {
    // Self-only read. Knowing who the admins are is the first step of targeting one.
    await seed(async (db) => {
      await set(ref(db, `admins/${ADMIN}`), true);
    });
    await assertFails(get(ref(asUser(ME), `admins/${ADMIN}`)));
    await assertFails(get(ref(asUser(ME), 'admins')));
  });

  it('is what actually grants cross-user writes', async () => {
    // The other half, and the reason the client-side isAdmin cache is allowed to be a
    // cache: an admin's power comes from this node existing, evaluated server-side on every
    // write. Not from a boolean in their session.
    await seed(async (db) => {
      await set(ref(db, `admins/${ADMIN}`), true);
      await set(ref(db, `users/${ME}/profile`), validProfile);
    });
    await assertSucceeds(get(ref(asAdmin(), `users/${ME}/profile`)));
    await assertSucceeds(
      set(ref(asAdmin(), `users/${ME}/profile`), { ...validProfile, bankrollCents: 1 })
    );
    // ...and a non-admin still cannot, which is what makes the line above mean something.
    await assertFails(get(ref(asUser(STRANGER), `users/${ME}/profile`)));
  });
});

describe('the multi-path write ProfileRepo.create actually performs', () => {
  it('lands both nodes at once', async () => {
    // profileRepo.create writes users/<uid>/profile AND leaderboard/<uid> in one `update`,
    // because RTDB validates every path in a multi-path update before applying any of it.
    // This asserts the rules permit that shape — a rule that allowed each node separately
    // but rejected the combined write would only fail in production.
    await assertSucceeds(
      update(ref(asUser(ME)), {
        [`users/${ME}/profile`]: validProfile,
        [`leaderboard/${ME}`]: validProfile,
      })
    );
  });

  it('lands NEITHER when one path is invalid', async () => {
    // The atomicity that makes the single `update` worth having: a projection that violates
    // the leaderboard pin cannot leave a private record written and a public one missing.
    await assertFails(
      update(ref(asUser(ME)), {
        [`users/${ME}/profile`]: validProfile,
        [`leaderboard/${ME}`]: { ...validProfile, leaked: 'x' },
      })
    );
    // `withSecurityRulesDisabled` resolves to void rather than passing the callback's
    // return through, so the answer has to come out by assignment.
    let existed = true;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await get(ref(ctx.database(), `users/${ME}/profile`));
      existed = snap.exists();
    });
    expect(existed).toBe(false);
  });
});
