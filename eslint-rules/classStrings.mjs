/**
 * Shared machinery for the two class-string rules.
 *
 * THE SCOPING PROBLEM, WHICH IS THE WHOLE DESIGN. The naive version of
 * `no-daisyui-classes` greps every string literal for "card". This repo is an
 * arcade: `'card'`, `'table'`, `'chat'`, `'stack'`, `'link'`, `'avatar'` and
 * `'rating'` are all DaisyUI component names AND words a card game says constantly.
 * A rule that fires on `const suit = deck.card` is a rule that gets disabled by the
 * first person it annoys — CLAUDE.md's own words — and then it protects nothing.
 *
 * So the rules are scoped to where a class name is unambiguously a class name:
 * inside `className` / `class` / `style`. In that position "card" has exactly one
 * meaning and there is no false positive to have.
 *
 * THE HOLE THIS LEAVES, stated plainly rather than pretended away: a class list
 * built at a distance —
 *
 *     const CLASSES = 'btn btn-primary';      // not in a className attribute
 *     <div className={CLASSES} />             // rule sees an Identifier, not a string
 *
 * — is not caught by the attribute scope. `no-daisyui-classes` closes most of it by
 * ALSO scanning every string in the file for the hyphenated forms (`btn-primary`,
 * `modal-box`), which no game domain says. What remains is the bare-word case at a
 * distance (`const c = 'card'`), and that is a deliberate, documented trade: it is
 * the price of not crying wolf on a deck of cards. A determined evasion of a lint
 * rule was never the threat model — the honest mistake is.
 */

/** Attributes whose value is, unambiguously, a class list. */
const CLASS_ATTRS = new Set(['className', 'class']);

/**
 * Every string the author wrote inside `node`, at any depth.
 *
 * Recursive rather than a fixed set of shapes, because the shapes are unbounded:
 * `className="btn"`, `className={'btn'}`, `className={cx('btn', big && 'btn-lg')}`,
 * `className={`btn ${x}`}`, `className={ok ? 'btn' : 'card'}` — and whatever idiom
 * shows up next. Walking the subtree handles all of them, including ones not
 * invented yet, for less code than enumerating four.
 */
function* stringsIn(node, seen = new Set()) {
  if (node === null || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const child of node) yield* stringsIn(child, seen);
    return;
  }
  if (typeof node.type !== 'string') return;

  if (node.type === 'Literal' && typeof node.value === 'string') {
    yield { node, value: node.value };
    return;
  }
  if (node.type === 'TemplateElement') {
    // `cooked` is null for an invalid escape; `raw` is always there.
    yield { node, value: node.value.cooked ?? node.value.raw };
    return;
  }

  for (const key of Object.keys(node)) {
    // `parent` walks back up the tree — following it recurses over the entire
    // program and, without the `seen` set, forever.
    if (key === 'parent' || key === 'loc' || key === 'range') continue;
    yield* stringsIn(node[key], seen);
  }
}

/**
 * Split a class-list string into tokens.
 *
 * Note the interpolation seam: `` `btn-${size}` `` yields the token "btn-", which
 * matches no rule below. Deliberate — the alternative is guessing what `size` holds,
 * and a rule that guesses is a rule that is wrong in one direction or the other.
 * Interpolating a variant into a component class is rare, and it is not the mistake
 * anyone actually makes.
 */
function tokensOf(value) {
  return value.split(/\s+/).filter(Boolean);
}

/*
 * DELIBERATELY NOT EXPORTED: a `classAttrVisitor(cb)` helper returning
 * `{ JSXAttribute() {…} }`.
 *
 * It existed, briefly, and it cost a dead rule. A rule that needs a second
 * JSXAttribute handler writes `{ ...classAttrVisitor(cb), JSXAttribute(n) {…} }`,
 * and an object spread REPLACES the key rather than merging the functions — so the
 * helper's visitor vanishes and the rule enforces half of what it says it does,
 * while reporting success. That happened to no-raw-palette and only the fixtures
 * found it.
 *
 * The helper saved four lines and hid a whole failure mode inside them. Each rule
 * now writes its own visitor and dispatches on the attribute name itself, where
 * the collision is impossible rather than merely unlikely. Four lines is not worth
 * a landmine.
 */
export { CLASS_ATTRS, stringsIn, tokensOf };
