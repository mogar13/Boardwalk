/**
 * The config reader — pure, and with two callers that cannot see each other: the browser
 * (`import.meta.env`) and `vite.config.ts` (`loadEnv`), which fails the BUILD on a missing
 * credential. This asserts the contract both of them depend on.
 */
import { describe, it, expect } from 'vitest';
import {
  REQUIRED_ENV_KEYS,
  missingConfigMessage,
  readFirebaseConfig,
} from '@/system/repo/firebase/config';

/** A complete env, built from the required list so it cannot drift out of date. */
const complete = (): Record<string, string> =>
  Object.fromEntries(REQUIRED_ENV_KEYS.map((k) => [k, `value-for-${k}`]));

describe('readFirebaseConfig', () => {
  it('accepts a complete env', () => {
    const result = readFirebaseConfig(complete());
    expect(result.ok).toBe(true);
  });

  it('reports EVERY missing key, not just the first', () => {
    // The person hitting this has, by definition, never got the app running. Reporting one
    // key at a time turns a two-minute setup into five rebuild cycles of a guessing game.
    const result = readFirebaseConfig({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toEqual([...REQUIRED_ENV_KEYS]);
  });

  it('treats an empty string as missing', () => {
    // The failure mode a types-only check cannot see, and the likely one: `.env.example` is
    // copied to `.env.local` and half-filled, so the key EXISTS and is ''. Firebase would
    // accept it and fail later with something unrelated-looking.
    const env = { ...complete(), VITE_FIREBASE_API_KEY: '   ' };
    const result = readFirebaseConfig(env);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missing).toEqual(['VITE_FIREBASE_API_KEY']);
  });

  it('omits measurementId entirely rather than setting it undefined', () => {
    // `exactOptionalPropertyTypes` is on, and this is the runtime half of it: Firebase's
    // options object treats a present-but-undefined key differently from an absent one.
    const result = readFirebaseConfig(complete());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('measurementId' in result.config).toBe(false);
  });

  it('includes measurementId when it is set', () => {
    const result = readFirebaseConfig({ ...complete(), VITE_FIREBASE_MEASUREMENT_ID: 'G-XYZ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.measurementId).toBe('G-XYZ');
  });

  it('does not require storageBucket or messagingSenderId', () => {
    // They are in every Firebase snippet and this app has no Storage and no Messaging. A
    // required variable that nothing reads is one that gets set wrong and never noticed.
    expect(REQUIRED_ENV_KEYS).not.toContain('VITE_FIREBASE_STORAGE_BUCKET');
    expect(REQUIRED_ENV_KEYS).not.toContain('VITE_FIREBASE_MESSAGING_SENDER_ID');
  });
});

describe('missingConfigMessage', () => {
  it('names every missing variable and both places they are set', () => {
    // This one string is read by someone stuck, in two contexts — a build failure and a
    // panel in the browser. Naming the keys is the whole value; "Firebase is not
    // configured" alone is the message that makes people read source.
    const msg = missingConfigMessage(['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID']);
    expect(msg).toContain('VITE_FIREBASE_API_KEY');
    expect(msg).toContain('VITE_FIREBASE_APP_ID');
    expect(msg).toContain('.env.local');
    expect(msg).toContain('secrets');
  });

  it('gets the singular right', () => {
    expect(missingConfigMessage(['VITE_FIREBASE_API_KEY'])).toContain('1 variable:');
    expect(missingConfigMessage(['a', 'b'])).toContain('2 variables:');
  });
});
