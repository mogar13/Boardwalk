import { relative, sep } from 'node:path';

/**
 * There is ONE modal, and it lives in the kit. Nothing outside `src/ui` may render a native
 * `<dialog>` of its own.
 *
 * WHY THIS IS WORTH A RULE RATHER THAN A CONVENTION. v1 has four modal systems. Not because anyone
 * decided to have four — because each one looked, in the pull request that added it, like a
 * perfectly reasonable twenty lines: a `<dialog>`, a close button, a bit of padding. The second
 * one is indistinguishable from the first at review time, and by the fourth the arcade no longer
 * looks like one product. That is the whole complaint the launch modal exists to answer
 * (plans/GAME_LAUNCH_MODAL.md §3), and the cheapest way to keep the answer true is to make the
 * first hand-rolled dialog unspellable rather than to notice the fourth.
 *
 * It is also not merely a look. `src/ui/Modal.tsx` carries a pile of things a fresh `<dialog>`
 * gets wrong and gets wrong SILENTLY: `open:grid` rather than a bare `grid` (a bare one beats the
 * UA's `dialog:not([open]) { display: none }` and leaves an invisible full-viewport element
 * hit-testing every click on the page — that shipped once and only a screenshot found it),
 * `showModal()` guarded both ways, `onCancel` routed through `onClose` so the dialog cannot close
 * itself behind React's back, a required accessible name, and focus restored on unmount.
 *
 * SCOPE: `src/ui` is exempt and everything else is not. The exemption is carried by the rule
 * rather than by a `files:` override in eslint.config.mjs, for the reason `no-firebase-imports`
 * states — a rule that owns its own boundary has no config knob to get wrong.
 *
 * THE HOLE, stated rather than pretended away: a modal hand-rolled out of a `<div>` and a portal
 * is not caught, because "a div that is behaving like a dialog" is not a thing a syntactic rule
 * can see without guessing. This catches the shape people actually reach for — `<dialog>` is the
 * right primitive, which is exactly why the second person to want a modal reaches for it — and
 * the div version is left to review, the same trade `no-daisyui-classes` documents for bare words.
 */

/** The one directory allowed to spell it. */
const KIT_DIR = 'src/ui';

const MSG =
  'Only src/ui may render a native <dialog>. Use <Modal> from @/ui/Modal — it already handles the ' +
  'open:grid trap (a bare `grid` beats the UA stylesheet and leaves an invisible full-viewport ' +
  'element hit-testing every click), the showModal/close guards, Esc routed through onClose, the ' +
  'required accessible name, and focus restoration on unmount. v1 has four modal systems because ' +
  'each one looked like a reasonable twenty lines in the PR that added it.';

const toPosix = (p) => p.split(sep).join('/');

/** `a/b` is inside `a` and inside `a/b`; NOT inside `a/bc`. */
const isInside = (path, base) => path === base || path.startsWith(`${base}/`);

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'One modal, and it is the kit’s. No hand-rolled <dialog> outside src/ui.',
    },
    schema: [],
    messages: { raw: MSG },
  },

  create(context) {
    const rel = toPosix(relative(context.cwd, context.filename));
    // The kit IS the modal. Nothing to say here.
    if (isInside(rel, KIT_DIR)) return {};

    return {
      JSXOpeningElement(node) {
        // The element name only — never a string, an identifier or a type. `'dialog'` as a value
        // and `HTMLDialogElement` as a type are both ordinary and neither is a second modal
        // system; a rule that fired on those would be a grep, and a grep gets disabled.
        if (node.name.type === 'JSXIdentifier' && node.name.name === 'dialog') {
          context.report({ node: node.name, messageId: 'raw' });
        }
      },
    };
  },
};
