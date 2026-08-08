/**
 * THE ONE MODAL, AT THE THREE WIDTHS IT MAY BE, AND A BODY THAT FLEXES INSTEAD OF CLAMPING.
 *
 * This is the kit's first test that looks at what a component actually RENDERS, and it needs to
 * be: everything here is a class string, and a class string typechecks however wrong it is. The
 * two failures it guards are both silent.
 *
 *   • A WIDTH THAT DOES NOT RESOLVE. Tailwind v4 builds `max-w-*` from its `--container-*` theme
 *     namespace, and an unmatched one is not an error — it emits nothing, and the box stays at
 *     whatever width it already had. That is `tests/theme-tokens.test.ts`'s bug in a different
 *     family, so it is checked the same way: resolve the name against the file that defines it.
 *   • TWO WIDTHS ON ONE BOX. If a `max-w-*` were left in the shared BOX list as well as coming
 *     from `MODAL_WIDTH`, both land on the element and CSS source order — not the `size` prop —
 *     decides which wins. Every size would render, plausibly, at the wrong width. So what is
 *     asserted is not "the right class is present" but "exactly one width class is present, and
 *     it is the right one".
 *
 * RENDERED, NOT GREPPED. `renderToStaticMarkup` runs the real component in Node with no DOM: the
 * effects (which is all `showModal()` is) do not run, the markup does. That means these assertions
 * are about what a browser is handed, not about what the source looks like — a body clamped by a
 * class added anywhere, in any spelling, is caught, where a source sweep for `max-h-[60vh]` would
 * only catch the one that was there before.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MODAL_WIDTH, Modal, type ModalSize } from '@/ui/Modal';

const ROOT = join(import.meta.dirname, '..');

/**
 * Where a `max-w-<name>` has to resolve. Tailwind's own theme declares the whole `--container-*`
 * scale; ours is read too, because the theme may add to that namespace and a width the repo
 * invented would be just as real as a built-in one.
 */
const THEME_FILES = [
  join(ROOT, 'node_modules/tailwindcss/theme.css'),
  join(ROOT, 'packages/theme/theme.css'),
];

function declaredContainers(): Set<string> {
  const names = new Set<string>();
  for (const file of THEME_FILES)
    for (const m of readFileSync(file, 'utf8').matchAll(/--container-([a-z0-9-]+)\s*:/g))
      if (m[1] !== undefined) names.add(m[1]);
  return names;
}

/** A distinctive child, so the body element can be found by what it wraps rather than by position. */
const MARKER = 'BODY-MARKER';

function render(size?: ModalSize): string {
  return renderToStaticMarkup(
    createElement(
      Modal,
      { open: true, onClose: () => undefined, title: 'Deal me in', size, footer: 'FOOTER-MARKER' },
      MARKER
    )
  );
}

/** The class list of the visible box — the first div inside the dialog. */
function boxClasses(html: string): string[] {
  return (/<dialog[^>]*><div class="([^"]*)"/.exec(html)?.[1] ?? '').split(/\s+/).filter(Boolean);
}

/** The class list of the element that directly wraps the children. */
function bodyClasses(html: string): string[] {
  const re = new RegExp(`<div class="([^"]*)">${MARKER}<`);
  return (re.exec(html)?.[1] ?? '').split(/\s+/).filter(Boolean);
}

function classesOf(html: string, tag: string): string[] {
  return (new RegExp(`<${tag} class="([^"]*)"`).exec(html)?.[1] ?? '').split(/\s+/).filter(Boolean);
}

describe('Modal — the three widths', () => {
  it('offers exactly sm/md/lg/xl, so a size is a rung and not a free width', () => {
    // A fifth rung is a decision, not an accident: the kit exists because a per-caller width is
    // how five modals end up five sizes. `xl` was the fourth, taken deliberately — the launch
    // modal's table setup does not fit two columns and a side column inside `lg`'s 48rem, and the
    // symptom was the one that rung was added to cure: a form you scroll.
    expect(Object.keys(MODAL_WIDTH)).toEqual(['sm', 'md', 'lg', 'xl']);
  });

  it('every width resolves to a --container-* the theme actually declares', () => {
    const containers = declaredContainers();
    // The guard's own failure mode: a regex that stops matching leaves this checking nothing.
    expect(containers.size).toBeGreaterThan(5);
    for (const [size, cls] of Object.entries(MODAL_WIDTH)) {
      const name = /^max-w-(.+)$/.exec(cls)?.[1];
      expect(
        name,
        `${size} is spelled '${cls}', which is not a max-w-* utility at all`
      ).toBeDefined();
      expect(
        containers.has(name ?? ''),
        `${size} → '${cls}', but no --container-${String(name)} exists: Tailwind generates nothing for it and the box silently keeps its previous width`
      ).toBe(true);
    }
  });

  it('puts exactly ONE width class on the box, and it is the one the size names', () => {
    for (const size of Object.keys(MODAL_WIDTH) as ModalSize[]) {
      const widths = boxClasses(render(size)).filter((c) => c.startsWith('max-w-'));
      // One, not "contains" — two widths on one element is decided by CSS source order rather
      // than by the prop, and it looks perfectly correct in the diff that adds it.
      expect(
        widths,
        `size="${size}" put ${String(widths.length)} width classes on the box`
      ).toEqual([MODAL_WIDTH[size]]);
    }
  });

  it('defaults to md — the width every dialog in the app already had', () => {
    // The three existing call sites (PackShelf, the confirm host, ProfileCard) pass no size, and
    // this change must not move any of them by a pixel.
    expect(boxClasses(render()).filter((c) => c.startsWith('max-w-'))).toEqual(['max-w-lg']);
  });
});

describe('Modal — the body flexes instead of clamping', () => {
  it('bounds the BOX by the viewport, not the body by a fraction of it', () => {
    // The box is never taller than the screen, so content scrolls only when the viewport genuinely
    // cannot hold it. The old `max-h-[60vh]` on the body could not promise that: header + 60vh +
    // footer is more than 100vh on a short viewport.
    expect(boxClasses(render())).toContain('max-h-full');
  });

  it('pins the dialog’s row, WITHOUT which max-h-full clamps nothing at all', () => {
    // The one assertion here that no amount of reading would have produced — it comes from a
    // browser. A grid row is auto-sized by default, so `max-height: 100%` on the item resolves
    // against a height the ITEM produced: 100% of itself. Measured at 1280×800 with a tall body,
    // the row came out 1463px, the box hung 679px off the bottom of the screen and the body never
    // scrolled — every unit assertion above still green, because the classes were all correct.
    //
    // These two classes are therefore ONE mechanism and neither is meaningful alone, which is why
    // they are asserted together and in the same test. `minmax(0,1fr)`, not `1fr`: a fr track
    // keeps an automatic min-content minimum, the same trap `min-h-0` exists for in flex.
    const dialog = (/<dialog[^>]*class="([^"]*)"/.exec(render())?.[1] ?? '').split(/\s+/);
    expect(dialog).toContain('grid-rows-[minmax(0,1fr)]');
    expect(dialog).toContain('h-full');
    expect(boxClasses(render())).toContain('max-h-full');
  });

  it('gives the body flex-1 and min-h-0, and NO max-height of its own', () => {
    const body = bodyClasses(render());
    expect(body).toContain('flex-1');
    // Without `min-h-0` a flex item refuses to shrink below its content, so the body ignores its
    // own overflow and pushes the footer out of the box. It is not decoration.
    expect(body).toContain('min-h-0');
    expect(body).toContain('overflow-y-auto');
    // Any spelling, not just the `max-h-[60vh]` that was there: this is the regression.
    expect(body.filter((c) => c.startsWith('max-h-'))).toEqual([]);
  });

  it('reserves room at the body’s edges for a glow the scrollport would otherwise CLIP', () => {
    // The body is `overflow-y-auto`, which makes it a scroll container, and a scroll container
    // clips at its PADDING BOX — the box-shadow of anything sitting against that edge included.
    // Every lit control in this kit is a `--shadow-glow-*` tube reaching ~18px, so with `pt-0` the
    // launch modal's first button had its whole top halo shaved off against a hard horizontal
    // line: it reads as a button cut in half, not as a clipped shadow. Measured in Chrome, the
    // button's top edge and the scrollport's top edge were the same pixel.
    //
    // The RUNG is asserted, not the exact class — what matters is that there is enough room for a
    // glow, and 4 (1rem) clears every visible layer of the token. Pinning `pt-5` would go red on a
    // tidy-up that changed nothing about the property.
    const body = bodyClasses(render());
    for (const side of ['pt', 'pb'] as const) {
      const found = body.filter((c) => new RegExp(`^${side}-\\d+$`).test(c));
      expect(
        found,
        `the body has no ${side}-* at all, so a glow at that edge is sliced`
      ).toHaveLength(1);
      const rung = Number(/-(\d+)$/.exec(found[0] ?? '')?.[1] ?? '0');
      expect(
        rung,
        `${found[0] ?? ''} is too tight for a --shadow-glow-* tube`
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it('gives the header its bottom padding back only when there is no body to own the gap', () => {
    // The gap between a description and the first control belongs to whichever element can hold it
    // WITHOUT clipping — which is the body, since it is the scrollport (above). A constant on the
    // header would either double the gap or, dropped, leave a childless confirm dialog's heading
    // 4px off the footer rule. So it is a ternary, and both sides are pinned.
    expect(classesOf(render(), 'header')).toContain('pb-1');
    const childless = renderToStaticMarkup(
      createElement(Modal, { open: true, onClose: () => undefined, title: 'Sure?' })
    );
    expect(classesOf(childless, 'header')).toContain('pb-4');
  });

  it('pins the header and the footer so only the body scrolls', () => {
    const html = render();
    expect(classesOf(html, 'header')).toContain('shrink-0');
    expect(classesOf(html, 'footer')).toContain('shrink-0');
  });

  it('still renders no body element at all when there are no children', () => {
    // The flex column has to survive the empty case — `useConfirm` renders a Modal with none.
    const html = renderToStaticMarkup(
      createElement(Modal, { open: true, onClose: () => undefined, title: 'Sure?' })
    );
    expect(html).toContain('<header');
    expect(bodyClasses(html)).toEqual([]);
  });
});
