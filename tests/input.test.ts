/**
 * THE KIT'S FIELDS DO NOT INVITE THE BROWSER TO ANSWER FOR YOU — except where a caller says so.
 *
 * THE COMPLAINT, verbatim: "the chat has the annoying browser suggestions/autofill/remember what
 * you typed, and we do not want that … that applies to all of Boardwalk." It is worst in chat
 * because the dropdown lands on top of the conversation, but it is the same nuisance in every field
 * in the app: a table code, a stake, a display name. None of them is a form the browser has any
 * business completing.
 *
 * WHY IT IS A DEFAULT AND NOT A POLICY. Sign-in is the one place the feature is the point — a
 * password manager filling `current-password` is what people expect and what they will complain
 * about losing. So the kit sets `autoComplete="off"` and `AuthPanel` opts back in by name, which
 * works only because the attribute is declared BEFORE `{...rest}` in the component. That ordering
 * is invisible in a diff, is trivially "tidied" the wrong way round, and would break sign-in
 * silently for everyone using a password manager while every test in this repo stayed green.
 *
 * RENDERED, NOT GREPPED, for `tests/modal.test.ts`'s reason: `renderToStaticMarkup` runs the real
 * component in Node with no DOM, so what is asserted is the markup a browser is handed rather than
 * what the source happens to look like. A prop reordering is caught wherever it is spelled.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Input } from '@/ui/Input';

const ROOT = join(import.meta.dirname, '..');

/**
 * CASE-INSENSITIVE, and that is not laziness. React 19's server renderer emits this one in its
 * camelCase spelling (`autoComplete="off"`) rather than lowering it, which an HTML parser treats
 * identically because attribute names are case-insensitive — but a `/autocomplete=/` matcher reads
 * that as "no autocomplete at all" and fails on a component that is entirely correct. Matching the
 * markup a browser is handed means matching it the way a browser reads it.
 */
const autocompleteOf = (html: string): string | null =>
  /autocomplete="([^"]*)"/i.exec(html)?.[1] ?? null;

describe('a kit field does not invite the browser to fill it', () => {
  it('is off by default, in every shape a field comes in', () => {
    for (const props of [
      { 'aria-label': 'Chat message' },
      { label: 'Table code' },
      { label: 'Stake', type: 'text', hint: 'How much a seat costs' },
      { label: 'Secret', type: 'password' as const },
    ])
      expect(autocompleteOf(renderToStaticMarkup(createElement(Input, props)))).toBe('off');
  });

  it('a caller that asks for it BY NAME wins — the spread order, as an assertion', () => {
    // The falsification is moving `autoComplete` after `{...rest}`: this case goes red and nothing
    // else does, which is exactly the shape of the failure (sign-in quietly stops being fillable).
    const html = renderToStaticMarkup(
      createElement(Input, {
        label: 'Password',
        type: 'password',
        autoComplete: 'current-password',
      })
    );
    expect(autocompleteOf(html)).toBe('current-password');
  });

  it('sign-in still opts in, on every field it has', () => {
    // The other half of the same rule, and the one no rendered assertion can reach: the kit's
    // default is only correct because the ONE screen that needs the feature asks for it. A tidy-up
    // that dropped these would be invisible — the fields would work, and every password manager
    // would stop offering to fill them.
    const src = readFileSync(join(ROOT, 'src/system/auth/AuthPanel.tsx'), 'utf8');
    const fields = src.match(/<Input\b/g)?.length ?? 0;
    const optIns = src.match(/autoComplete=/g)?.length ?? 0;
    expect(fields).toBeGreaterThan(0);
    expect(optIns, 'every field on the sign-in form must name its own autoComplete').toBe(fields);
  });
});
