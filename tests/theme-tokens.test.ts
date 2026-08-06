/**
 * EVERY GLOW, SHADOW AND ANIMATION A COMPONENT SPELLS IS ONE THE THEME DEFINES.
 *
 * This guards a bug the whole rest of the pipeline is blind to, and it is not hypothetical — it
 * shipped. UNO's pot label carried `text-shadow-neon-gold` while `--text-shadow-neon-gold` did not
 * exist in `packages/theme/theme.css`, so the pot rendered flat from the day it landed. Nothing
 * caught it and nothing could:
 *
 *   - `tsc` sees a string literal.
 *   - `no-raw-palette` looks for raw colours; `text-shadow-neon-gold` is not one.
 *   - `no-daisyui-classes` looks for DaisyUI component words; this is not one either.
 *   - Tailwind v4 generates `text-shadow-*` / `shadow-*` / `animate-*` utilities ONLY from matching
 *     `--text-shadow-*` / `--shadow-*` / `--animate-*` theme tokens, and an unmatched one is not an
 *     error. It emits nothing, silently, and the element simply has no shadow.
 *
 * That last property is what makes this the same category as `tests/audio.test.ts` and
 * `tests/cards.test.ts`: a name that is a dead reference, where the only possible check is to
 * resolve it against the thing that defines it. Those two resolve filenames against disk; this
 * resolves utility names against the one file allowed to name a colour.
 *
 * SCOPED TO THE THEME-OWNED NAMESPACES, deliberately. Tailwind ships its own `shadow-sm`,
 * `animate-spin` and so on, so a blanket sweep would fail on utilities the framework defines. What
 * is checked is the families where `theme.css` is the ONLY source — every `shadow-glow-*`, every
 * `text-shadow-*`, and every `animate-*` outside Tailwind's built-in set — which is exactly where
 * this repo adds tokens and therefore exactly where a typo hides.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const THEME = readFileSync(join(ROOT, 'packages/theme/theme.css'), 'utf8');

/** Tailwind's own keyframe utilities. Everything else must come from an `--animate-*` token. */
const BUILT_IN_ANIMATIONS = new Set(['spin', 'ping', 'pulse', 'bounce', 'none']);

/**
 * The families to check, each as the utility prefix and the custom-property prefix it must resolve
 * against. `shadow-glow-` is listed separately from `shadow-` on purpose: `shadow-lift`,
 * `shadow-sm` and `shadow-none` are a mix of ours and Tailwind's, while every single
 * `shadow-glow-*` in this repo is ours.
 */
const FAMILIES = [
  { utility: 'shadow-glow-', token: '--shadow-glow-' },
  { utility: 'text-shadow-', token: '--text-shadow-' },
  { utility: 'animate-', token: '--animate-' },
] as const;

/** Every `--name:` declared in the theme, so a lookup is a set membership rather than a regex. */
function declaredTokens(prefix: string): Set<string> {
  const found = new Set<string>();
  const re = new RegExp(`${prefix.replace(/-/g, '\\-')}([a-z0-9-]+)\\s*:`, 'g');
  for (const m of THEME.matchAll(re)) if (m[1] !== undefined) found.add(m[1]);
  return found;
}

/** Every `.ts`/`.tsx` under `src/`, which is where className strings live. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

interface Use {
  readonly name: string;
  readonly file: string;
}

/**
 * Utility uses of one family across the source tree. Matched on a word boundary and allowing
 * Tailwind's variant prefixes (`hover:`, `group-hover:`, `sm:`) by simply not anchoring the left
 * side to whitespace — a variant is separated by `:`, which is not part of the name.
 */
function usesOf(files: readonly string[], utility: string): Use[] {
  const re = new RegExp(`(?<![a-z0-9-])${utility.replace(/-/g, '\\-')}([a-z0-9-]+)`, 'g');
  const out: Use[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) {
      if (m[1] !== undefined) out.push({ name: m[1], file: file.slice(ROOT.length) });
    }
  }
  return out;
}

describe('theme tokens', () => {
  const files = sourceFiles(join(ROOT, 'src'));

  it('finds source to scan and tokens to scan for', () => {
    // Guard the guard: an empty file list or an unparsed theme would make every case below pass
    // vacuously, which is the failure mode this whole suite exists to prevent.
    expect(files.length).toBeGreaterThan(50);
    expect(declaredTokens('--shadow-glow-').size).toBeGreaterThan(0);
    expect(declaredTokens('--text-shadow-').size).toBeGreaterThan(0);
    expect(declaredTokens('--animate-').size).toBeGreaterThan(0);
  });

  for (const { utility, token } of FAMILIES) {
    it(`every \`${utility}*\` used in src/ is defined as \`${token}*\` in theme.css`, () => {
      const declared = declaredTokens(token);
      const dangling = usesOf(files, utility).filter(
        (use) =>
          !declared.has(use.name) &&
          !(utility === 'animate-' && BUILT_IN_ANIMATIONS.has(use.name)) &&
          // `text-shadow-` also spells Tailwind's own sizes and the reset.
          !(
            utility === 'text-shadow-' && ['sm', 'md', 'lg', 'xl', '2xl', 'none'].includes(use.name)
          )
      );
      const report = dangling.map((d) => `${utility}${d.name} (${d.file})`).join('\n  ');
      expect(
        dangling,
        `utilities with no theme token — these render NOTHING:\n  ${report}`
      ).toEqual([]);
    });
  }

  it('the two tokens UNO added are real, and gold is still money', () => {
    // Named directly rather than left to the sweep, because the sweep only proves that whatever is
    // spelled resolves — it cannot say these two exist, and a rename would silently satisfy it.
    expect(declaredTokens('--shadow-glow-').has('uno')).toBe(true);
    expect(declaredTokens('--text-shadow-').has('neon-gold')).toBe(true);
    // The glow budget: UNO's call borrows the amber `warning` and adds no hue, and the gold text
    // shadow is the money accent. Swapping either would typecheck and look plausible on screen.
    const glowUno = /--shadow-glow-uno:[^;]+;/.exec(THEME)?.[0] ?? '';
    expect(glowUno).toContain('--color-warning');
    expect(glowUno).not.toContain('--color-accent');
    const neonGold = /--text-shadow-neon-gold:[^;]+;/.exec(THEME)?.[0] ?? '';
    expect(neonGold).toContain('--color-accent');
  });
});
