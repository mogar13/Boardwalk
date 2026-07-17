/**
 * Join class names, dropping anything falsy.
 *
 * Ten lines instead of `clsx`, for one reason: this is the entire API surface we
 * would use, and a dependency whose whole value is `.filter(Boolean).join(' ')` is
 * a supply-chain edge and a version to bump forever. If we ever need conditional
 * objects or nested arrays, take clsx then — not now, on the guess that we might.
 *
 * NOT tailwind-merge. Deliberate: `cx('bg-primary', className)` does NOT resolve a
 * conflict, it emits both and lets the cascade pick — which for two same-specificity
 * utilities means source order in the stylesheet, not the order you wrote them. The
 * fix is not a merge library; it is that a caller passing `bg-*` to a kit component
 * is already reaching around the variant record, and the variant record is the API.
 * Add the variant instead. (`no-raw-palette` catches the worst version of this: the
 * caller cannot even spell `bg-[#ff2c86]`.)
 */
export type ClassValue = string | false | null | undefined;

export function cx(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(' ');
}
