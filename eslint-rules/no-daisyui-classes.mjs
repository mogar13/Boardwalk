import { CLASS_ATTRS, stringsIn, tokensOf } from './classStrings.mjs';

/**
 * `src/ui` is the only place that may spell a DaisyUI component class.
 *
 * WHY. This is the single rule that makes VS-Dashboard look like one product, and
 * ARCHITECTURE.md is blunt that a neon casino needs it MORE than a dashboard does,
 * not less: "neon without a system looks like a ransom note." The mechanism is that
 * `btn` cannot be written outside the kit, so the only way to get a button is
 * <Button variant="…"> — and then a button is the same button everywhere, forever,
 * because there is no second way to make one.
 *
 * The trap it is really guarding, from VS-Dashboard: `btn-primary` is BLUE. They
 * reserve blue for information and never for action. So the raw class is not merely
 * inconsistent — it is wrong, and it is wrong in a way that reads as fine. Here,
 * DaisyUI's `btn-primary` would render our magenta and STILL be wrong, because it
 * would skip the glow, the rim, the strike easing and the disabled desaturation
 * that make a Boardwalk button a lit sign rather than a coloured rectangle.
 *
 * TWO TIERS, because the words are not equally safe (see classStrings.mjs):
 *
 *   • hyphenated (`btn-primary`, `modal-box`) — flagged in ANY string in the file.
 *     No game domain says "modal-box", so there is no false positive to have, and
 *     scanning everywhere closes the class-list-built-at-a-distance hole.
 *
 *   • bare (`btn`, `card`, `modal`) — flagged only inside className/class, because
 *     `'card'` is a word this arcade genuinely says.
 */

/**
 * DaisyUI 5 component roots.
 *
 * Deliberately EXCLUDED, and this is the subtle part: `table`, `filter` and
 * `collapse` are also real Tailwind utilities (`display:table`, `filter:…`,
 * `visibility:collapse`). Banning those bare words would fire on legitimate layout
 * code, and a rule that is wrong once gets an eslint-disable that then hides the
 * times it was right. Their hyphenated forms (`table-zebra`, `collapse-title`) are
 * unambiguous and stay banned via TIER 1 below.
 */
const COMPONENT_ROOTS = [
  'alert',
  'avatar',
  'badge',
  'breadcrumbs',
  'btn',
  'card',
  'carousel',
  'chat',
  'checkbox',
  'countdown',
  'diff',
  'divider',
  'dock',
  'drawer',
  'dropdown',
  'fab',
  'fieldset',
  'file-input',
  'footer',
  'hero',
  'indicator',
  'input',
  'join',
  'kbd',
  'label',
  'link',
  'list',
  'loading',
  'mask',
  'menu',
  'modal',
  'navbar',
  'progress',
  'radial-progress',
  'radio',
  'range',
  'rating',
  'select',
  'skeleton',
  'stack',
  'stat',
  'stats',
  'status',
  'step',
  'steps',
  'swap',
  'tab',
  'tabs',
  'textarea',
  'timeline',
  'toast',
  'toggle',
  'tooltip',
  'validator',
];

/** Colliding roots: hyphenated forms banned, bare word allowed. See above. */
const TAILWIND_COLLISIONS = ['collapse', 'filter', 'table'];

const ALL_ROOTS = [...COMPONENT_ROOTS, ...TAILWIND_COLLISIONS];

// Longest-first so `radial-progress` wins over `progress`, and `stats` over `stat`.
const byLength = (a, b) => b.length - a.length;
const alt = (roots) => roots.slice().sort(byLength).join('|');

/** TIER 1: `btn-primary`, `modal-box`, `table-zebra` — anywhere in the file. */
const HYPHENATED = new RegExp(`^(?:${alt(ALL_ROOTS)})(?:-[a-z0-9]+)+$`);

/** TIER 2: bare `btn`, `card` — in a className attribute only. */
const BARE = new RegExp(`^(?:${alt(COMPONENT_ROOTS)})$`);

const MESSAGE =
  "'{{token}}' is a DaisyUI class, and src/ui is the only place allowed to spell one. " +
  'Use the kit — <Button variant="primary">, <Card>, <Modal>, <Input> — or add a variant to it. ' +
  'A raw DaisyUI class skips the glow, the rim and the disabled state that make this look like one product; ' +
  "VS-Dashboard's btn-primary is blue, and that is the bug this rule exists for.";

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ban raw DaisyUI component classes outside the src/ui kit.',
    },
    schema: [],
    messages: { daisy: MESSAGE },
  },

  create(context) {
    const reported = new Set();

    const report = (node, token) => {
      // A single string can carry several banned tokens; report the string once, or
      // `className="btn btn-primary btn-lg"` becomes three errors on one mistake and
      // the output stops being readable.
      if (reported.has(node)) return;
      reported.add(node);
      context.report({ node, messageId: 'daisy', data: { token } });
    };

    return {
      // TIER 1 — the whole program.
      Program(program) {
        for (const { node, value } of stringsIn(program)) {
          const hit = tokensOf(value).find((t) => HYPHENATED.test(t));
          if (hit !== undefined) report(node, hit);
        }
      },

      // TIER 2 — className/class only.
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier') return;
        if (!CLASS_ATTRS.has(node.name.name)) return;
        if (node.value === null) return;
        for (const { node: strNode, value } of stringsIn(node.value)) {
          const hit = tokensOf(value).find((t) => BARE.test(t));
          if (hit !== undefined) report(strNode, hit);
        }
      },
    };
  },
};
