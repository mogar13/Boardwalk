import { useState } from 'react';
import { Button, Card, Input, useToast } from '@/ui';
import { useAuth } from '@/system/auth/useAuth';
import { MIN_PASSWORD_LENGTH } from '@/system/auth/credentials';

/**
 * Sign in, or make an account. Phase 2's proof that the data layer is wired to something
 * real — Phase 3 owns the router, the top bar and the auth gate, and this moves into the
 * shell then.
 *
 * IT IS ALSO THE DOG FOOD, in the sense App.tsx has been since Phase 1: this file is
 * outside `src/ui`, so both Phase 1 lint rules apply in full. It cannot spell `btn` and it
 * cannot spell a colour. Everything below is the kit plus semantic tokens — which is the
 * same constraint every game is under from Phase 6, tested here first on something small.
 */

type Mode = 'signin' | 'signup';

export function AuthPanel() {
  const { status, busy, signIn, signUp } = useAuth();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>('signin');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 'unknown' is not 'signed-out'. Rendering a sign-in form here would flash it at every
  // returning player on every reload, because Firebase restores the session a tick after
  // first paint. See the Status type in authStore.
  if (status === 'unknown') {
    return (
      <Card className="flex items-center justify-center p-10">
        <p className="text-bw-muted text-sm">Checking your session…</p>
      </Card>
    );
  }

  const submit = () => {
    void (async () => {
      setError(null);
      const result =
        mode === 'signin'
          ? await signIn({ identifier, password })
          : await signUp({
              username: identifier,
              password,
              // `exactOptionalPropertyTypes` is on, so `email: undefined` is NOT the same
              // as an absent key — and the difference is load-bearing here rather than
              // pedantic: absent means "synthetic identity, no recovery", present means
              // "the real address is the login". Spreading a conditional is how you
              // actually omit it.
              ...(email.trim() === '' ? {} : { email: email.trim() }),
            });

      if (!result.ok) {
        // Into the form, not a toast. This is a field-level failure the user must fix
        // before the button will work again — a toast for it disappears while they are
        // still reading the form it was about.
        setError(result.error);
        return;
      }
      toast.success(mode === 'signin' ? 'Welcome back.' : 'Account created. Fresh $5,000.');
    })();
  };

  const isSignUp = mode === 'signup';

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-base-content text-sm font-semibold tracking-[0.2em] uppercase">
          {isSignUp ? 'New account' : 'Sign in'}
        </h2>
        <p className="text-bw-muted text-sm">
          {isSignUp
            ? 'Boardwalk accounts are separate from The Game Shack. New account, fresh $5,000.'
            : 'Use your username, or your email if you signed up with one.'}
        </p>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          // A form, so Enter submits. A div full of inputs with a click handler is the
          // version that works for everyone except keyboard users.
          e.preventDefault();
          submit();
        }}
      >
        <Input
          label={isSignUp ? 'Username' : 'Username or email'}
          value={identifier}
          autoComplete={isSignUp ? 'username' : 'username email'}
          {...(isSignUp ? { hint: 'Letters, numbers and underscores. 2–16 characters.' } : {})}
          onChange={(e) => {
            setIdentifier(e.target.value);
          }}
        />

        {isSignUp && (
          <Input
            label="Email — optional"
            type="email"
            value={email}
            autoComplete="email"
            // The single most important sentence on this page. An account with no email
            // has NO recovery path — the synthetic address is unroutable by construction
            // (RFC 2606 `.invalid`), so there is nowhere to send a reset. They have to
            // know that BEFORE they choose, not after they forget.
            hint="Without one, your password can never be reset. There is nowhere to send it."
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        )}

        <Input
          label="Password"
          type="password"
          value={password}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          {...(isSignUp ? { hint: `At least ${String(MIN_PASSWORD_LENGTH)} characters.` } : {})}
          {...(error === null ? {} : { error })}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" type="submit" disabled={busy}>
            {isSignUp ? 'Create account' : 'Sign in'}
          </Button>
          <Button
            variant="quiet"
            type="button"
            onClick={() => {
              setMode(isSignUp ? 'signin' : 'signup');
              setError(null);
            }}
          >
            {isSignUp ? 'I have an account' : 'Create one instead'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
