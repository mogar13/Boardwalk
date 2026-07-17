import { CLASS_ATTRS, stringsIn, tokensOf } from './classStrings.mjs';

/**
 * Semantic tokens only. `packages/theme` is the only place a colour exists.
 *
 * WHY THIS IS A DIFFERENT RULE FROM no-daisyui-classes, and stricter: that one has
 * an exemption for src/ui, because the kit has to spell component classes to build
 * components. This one has NO exemption anywhere. The kit is not allowed a raw
 * colour either — a hex in Button.tsx is exactly as unreachable from the theme as a
 * hex in a game, and "the kit is special" is how a second palette starts.
 *
 * So: the ONE file that may name a colour is packages/theme/theme.css. Change the
 * look there and it changes everywhere at once. That is the property v1 never had —
 * its cosmetics drifted into two parallel schemas (`loadout.color`, written by the
 * hub and read by nothing, alongside `profile.chatColor`, which chat actually
 * reads), and Firebase config was pasted inline into 32 HTML files. Both are the
 * same defect: a value with no single home ends up with several.
 *
 * WHAT IS BANNED:
 *   1. Tailwind's palette scale       — `bg-pink-500`, `text-slate-300/50`
 *   2. Absolute colours               — `text-white`, `bg-black`
 *   3. Arbitrary colour values        — `bg-[#ff2c86]`, `text-[oklch(66%_.245_2)]`
 *   4. Colour literals in `style={}`  — `style={{ color: '#ff2c86' }}`
 *
 * WHAT IS NOT, and why each is right rather than an oversight:
 *   • `bg-base-200`, `text-primary-content`, `border-bw-line` — the point.
 *   • `bg-primary/90`, `bg-base-100/70` — an opacity modifier on a token is still
 *     the token. Alpha is composition, not a new colour.
 *   • `bg-transparent`, `text-current`, `border-inherit` — not colours; they are
 *     "no colour" and "the colour already decided". Banning them would push people
 *     toward a real value, which is worse.
 *   • `shadow-lift`, `shadow-glow-primary` — theme tokens. This is why --shadow-lift
 *     exists at all: without it the kit needed `shadow-black/60` and this rule would
 *     have needed an exception, and a rule with an exception is a rule with an
 *     argument attached to it.
 */

const TAILWIND_PALETTE = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
];

/** Utility prefixes that take a colour. */
const COLOUR_PREFIXES = [
  'accent',
  'bg',
  'border',
  'caret',
  'decoration',
  'divide',
  'fill',
  'from',
  'outline',
  'placeholder',
  'ring',
  'shadow',
  'stroke',
  'text',
  'to',
  'via',
];

const PREFIX = COLOUR_PREFIXES.join('|');
// Sides and corners: `border-t-red-500`, `border-l-info`, `divide-x-…`.
const SIDE = '(?:-(?:t|r|b|l|s|e|x|y|tl|tr|br|bl|ss|se|es|ee))?';
// Tailwind variants stack on the front: `hover:`, `dark:`, `group-open:`, `sm:`.
const VARIANTS = '(?:[a-z0-9-]+(?:\\[[^\\]]*\\])?:)*';
const OPACITY = '(?:\\/(?:\\d{1,3}|\\[[^\\]]*\\]))?';

/**
 * `neutral` is in BOTH lists — it is a Tailwind palette ramp AND a DaisyUI semantic
 * token. The digits are what tell them apart: `bg-neutral-500` is the ramp (banned),
 * `bg-neutral` and `bg-neutral-content` are the token (fine). Requiring `\d` is not
 * a detail; without it this rule bans a token it is supposed to require.
 */
const SCALE = new RegExp(
  `^${VARIANTS}(?:${PREFIX})${SIDE}-(?:${TAILWIND_PALETTE.join('|')})-\\d{2,3}${OPACITY}$`
);

/** `text-white`, `bg-black`. Absolute, and still not ours to pick. */
const ABSOLUTE = new RegExp(`^${VARIANTS}(?:${PREFIX})${SIDE}-(?:white|black)${OPACITY}$`);

/** `bg-[#ff2c86]`, `text-[rgb(255_44_134)]`, `border-[oklch(66%_.245_2)]`. */
const ARBITRARY = new RegExp(
  `^${VARIANTS}(?:${PREFIX})${SIDE}-\\[\\s*(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\\()`
);

/** A bare colour in a style object: '#ff2c86', 'rgb(…)', 'oklch(…)'. */
const CSS_COLOUR_LITERAL =
  /(?:^|[\s:(,])(?:#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\()/;

const CLASS_MSG =
  "'{{token}}' is a raw colour. Use a semantic token — bg-base-200, text-primary-content, border-bw-line. " +
  'packages/theme/theme.css is the only file allowed to name a colour, which is what makes the look changeable in one place ' +
  "instead of drifting the way v1's loadout.color and profile.chatColor did.";

const STYLE_MSG =
  "'{{token}}' is a raw colour in a style attribute. Use a className with a semantic token, or add a token to packages/theme/theme.css. " +
  'An inline colour cannot be themed and cannot be found by anyone changing the look later.';

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ban raw palette values; require semantic theme tokens.',
    },
    schema: [],
    messages: { raw: CLASS_MSG, rawStyle: STYLE_MSG },
  },

  create(context) {
    const reported = new Set();

    const report = (node, token, messageId) => {
      if (reported.has(node)) return;
      reported.add(node);
      context.report({ node, messageId, data: { token } });
    };

    // ONE JSXAttribute visitor, dispatching on the attribute name.
    //
    // It reads like two rules and must not be written as two. The first draft was
    // `{ ...classAttrVisitor(…), JSXAttribute(node) {…} }` — and an object spread
    // does not merge functions, it REPLACES them, so the `style` handler silently
    // deleted the `className` handler and this rule quietly enforced nothing but
    // inline styles. It reported success the whole time. Only the fixtures caught
    // it, which is the entire argument for tests/lint-rules.test.ts existing: the
    // rule was written, wired, and dead, and nothing else in the pipeline noticed.
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier') return;
        if (node.value === null) return;
        const attr = node.name.name;

        if (CLASS_ATTRS.has(attr)) {
          for (const { node: strNode, value } of stringsIn(node.value)) {
            const hit = tokensOf(value).find(
              (t) => SCALE.test(t) || ABSOLUTE.test(t) || ARBITRARY.test(t)
            );
            if (hit !== undefined) report(strNode, hit, 'raw');
          }
          return;
        }

        // `style={{ color: '#ff2c86' }}` — the other road to the same place. Scoped
        // to the style attribute rather than every string in the file, because
        // '#ace' is a valid hex AND a plausible chat channel, and the rule that
        // fires on both is the rule that gets turned off.
        if (attr === 'style') {
          for (const { node: strNode, value } of stringsIn(node.value)) {
            if (CSS_COLOUR_LITERAL.test(value)) report(strNode, value, 'rawStyle');
          }
        }
      },
    };
  },
};
