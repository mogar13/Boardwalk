/**
 * The kit's front door. Import from `@/ui`, never from `@/ui/Button`.
 *
 * Why a barrel at all, when barrels are usually a bundling liability: this one is
 * the seam the DaisyUI-class ban is drawn around. `no-daisyui-classes` allows
 * `src/ui/**` and nothing else, so "what may spell a component class" and "what is
 * exported here" have to be the same set — a barrel makes that set a list you can
 * read in one screen instead of a directory you have to trust.
 *
 * It is safe here in a way it would not be elsewhere: every module below is a leaf
 * with no side effects at import, so Vite tree-shakes what a route does not use.
 * If anything in this directory ever grows an import-time side effect, that stops
 * being true and this file becomes the reason every game bundle contains the
 * whole kit.
 */
export { Button } from '@/ui/Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from '@/ui/Button';

export { Card } from '@/ui/Card';
export type { CardProps } from '@/ui/Card';

export { Input } from '@/ui/Input';
export type { InputProps } from '@/ui/Input';

export { Modal } from '@/ui/Modal';
export type { ModalProps } from '@/ui/Modal';

/** Mount once at the app root. Toasts and confirm() do not work without it. */
export { UiRoot } from '@/ui/UiRoot';

export { useToast } from '@/ui/useToast';
export type { ToastApi, ToastTone } from '@/ui/useToast';

export { useConfirm } from '@/ui/useConfirm';
export type { ConfirmApi, ConfirmRequest } from '@/ui/useConfirm';

export { cx } from '@/ui/cx';
export type { ClassValue } from '@/ui/cx';
