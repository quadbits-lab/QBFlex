import { useState, type ReactNode } from 'react';
import { useForm } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useNavigate,
  useRouter,
  useSearch,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { ShieldCheck, BookOpen, KeyRound } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Input,
  Field,
  FieldLabel,
  FieldGroup,
  FieldDescription,
  Separator,
  Brand,
  AppFooter,
  notifyError,
  toast,
} from '@qb-flex/ui';
import { raw, docsURL } from './api';
import { bootstrapHint } from './bootstrap-hint';
import { platformAuth } from './platform-auth';
import { confirmPlatformSignIn, setupOptions, type SetupState } from './session';

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background px-4">
      <main
        id="main"
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 py-10"
      >
        <div className="flex justify-center">
          <Brand />
        </div>
        {children}
      </main>
      <AppFooter />
    </div>
  );
}

export function SignInScreen() {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const search = useSearch({ from: '/sign-in' });
  const [challenge, setChallenge] = useState(false);
  const [code, setCode] = useState('');
  const [passkeyPending, setPasskeyPending] = useState(false);
  const onDone = async () => {
    await confirmPlatformSignIn(cache);
    toast.success('Signed in');
    await navigate({ to: search.redirect, replace: true });
  };
  const form = useForm({
    defaultValues: { email: '', password: '' },
    onSubmit: async ({ value }) => {
      try {
        const result = await raw('/platform/auth/sign-in/email', 'POST', value);
        if (result.twoFactorRedirect) {
          setChallenge(true);
          toast.message('Authenticator required', {
            description: 'Enter the code from your authenticator app.',
          });
          return;
        }
        await onDone();
      } catch (e) {
        notifyError(e, 'Sign-in failed');
      }
    },
  });
  return (
    <AuthLayout>
      <Card className="w-full">
        <CardHeader className="gap-3">
          <div className="grid grid-cols-1 size-10 place-items-center rounded-lg border bg-muted">
            <ShieldCheck size={24} aria-hidden="true" />
          </div>
          <p className="m-0 text-[10px] uppercase tracking-widest text-muted-foreground">
            YOUR BACKEND, YOUR CONTROL
          </p>
          <CardTitle>
            <h1 className="m-0 text-2xl">Welcome back</h1>
          </CardTitle>
          <CardDescription>Sign in to manage your projects.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {challenge ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await raw('/platform/auth/two-factor/verify-totp', 'POST', { code });
                  await onDone();
                } catch (err) {
                  notifyError(err, 'Invalid authenticator code');
                }
              }}
            >
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="signin-code">Authenticator code</FieldLabel>
                  <Input
                    required
                    inputMode="numeric"
                    id="signin-code"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </Field>
                <Button type="submit" className="w-full">
                  Verify sign in
                </Button>
              </FieldGroup>
            </form>
          ) : (
            <form
              className="grid grid-cols-1 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void form.handleSubmit();
              }}
            >
              <FieldGroup>
                <form.Field name="email">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="signin-email">Email</FieldLabel>
                      <Input
                        required
                        type="email"
                        id="signin-email"
                        autoComplete="email"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="password">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="signin-password">Password</FieldLabel>
                      <Input
                        required
                        type="password"
                        id="signin-password"
                        autoComplete="current-password"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                      />
                    </Field>
                  )}
                </form.Field>
                <form.Subscribe selector={(s) => s.isSubmitting}>
                  {(pending) => (
                    <Button disabled={pending} type="submit" className="w-full">
                      {pending ? 'Please wait…' : 'Sign in'}
                    </Button>
                  )}
                </form.Subscribe>
                <div className="flex items-center gap-3 text-2xs text-muted-foreground">
                  <Separator className="flex-1" /> or <Separator className="flex-1" />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  disabled={passkeyPending}
                  onClick={async () => {
                    setPasskeyPending(true);
                    try {
                      const result = await platformAuth.signIn.passkey();
                      if (result.error)
                        throw new Error(result.error.message ?? 'Passkey sign-in failed');
                      await onDone();
                    } catch (e) {
                      notifyError(e, 'Passkey sign-in failed');
                    } finally {
                      setPasskeyPending(false);
                    }
                  }}
                >
                  <KeyRound size={15} aria-hidden="true" />
                  {passkeyPending ? 'Waiting for authenticator…' : 'Sign in with passkey'}
                </Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
      <a
        href={docsURL + '/docs/getting-started/installation'}
        className="flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <BookOpen size={15} aria-hidden="true" /> Installation and setup guide
      </a>
    </AuthLayout>
  );
}

/**
 * Tell the operator which credential the API actually expects. The API reports the
 * source without exposing the secret, so this avoids guessing across deployment modes.
 */
function BootstrapHint({ source }: { source?: SetupState['data']['tokenSource'] }) {
  const hint = bootstrapHint(source);
  return (
    <>
      {hint.message}
      {hint.commands.map((command) => (
        <code key={command} className="mt-1 block text-[11px] break-all">
          {command}
        </code>
      ))}
    </>
  );
}

export function SetupScreen() {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const setup = useQuery(setupOptions());
  const onDone = async () => {
    await cache.cancelQueries();
    cache.clear();
    await navigate({ to: '/sign-in', search: { redirect: '/overview' }, replace: true });
  };
  const form = useForm({
    defaultValues: {
      name: '',
      email: '',
      password: '',
      organization: 'Personal workspace',
      bootstrapToken: '',
    },
    onSubmit: async ({ value }) => {
      try {
        await raw('/setup', 'POST', value);
        toast.success('Workspace created');
        await onDone();
      } catch (e) {
        notifyError(e, 'Setup failed');
      }
    },
  });
  const fields = ['name', 'organization', 'email', 'password', 'bootstrapToken'] as const;
  const labelFor: Record<(typeof fields)[number], string> = {
    name: 'Name',
    organization: 'Organization',
    email: 'Email',
    password: 'Password',
    bootstrapToken: 'Bootstrap token',
  };
  return (
    <AuthLayout>
      <Card className="w-full">
        <CardHeader className="gap-3">
          <div className="grid grid-cols-1 size-10 place-items-center rounded-lg border bg-muted">
            <ShieldCheck size={24} aria-hidden="true" />
          </div>
          <p className="m-0 text-[10px] uppercase tracking-widest text-muted-foreground">
            YOUR BACKEND, YOUR CONTROL
          </p>
          <CardTitle>
            <h1 className="m-0 text-2xl">Set up your workspace</h1>
          </CardTitle>
          <CardDescription>Create the first platform owner and organization.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="grid grid-cols-1 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            <FieldGroup>
              {fields.map((name) => (
                <form.Field name={name} key={name}>
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor={'setup-' + name}>{labelFor[name]}</FieldLabel>
                      <Input
                        id={'setup-' + name}
                        required
                        type={
                          name === 'password' || name === 'bootstrapToken'
                            ? 'password'
                            : name === 'email'
                              ? 'email'
                              : 'text'
                        }
                        minLength={name === 'password' ? 12 : undefined}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        autoComplete={
                          name === 'password'
                            ? 'new-password'
                            : name === 'email'
                              ? 'email'
                              : undefined
                        }
                      />
                      {name === 'bootstrapToken' && (
                        <FieldDescription>
                          <BootstrapHint source={setup.data?.data.tokenSource} />
                        </FieldDescription>
                      )}
                    </Field>
                  )}
                </form.Field>
              ))}
              <form.Subscribe selector={(s) => s.isSubmitting}>
                {(pending) => (
                  <Button disabled={pending} type="submit" className="w-full">
                    {pending ? 'Please wait…' : 'Create workspace'}
                  </Button>
                )}
              </form.Subscribe>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <a
        href={docsURL + '/docs/getting-started/installation'}
        className="flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <BookOpen size={15} aria-hidden="true" /> Installation and setup guide
      </a>
    </AuthLayout>
  );
}

export function AuthUnavailableScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <AuthLayout>
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Connection unavailable</CardTitle>
          <CardDescription>Check the API connection and try again.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="m-0 text-sm text-muted-foreground">API unavailable: {error.message}</p>
          <Button
            className="w-full"
            onClick={() => {
              notifyError(error, 'API unavailable');
              onRetry();
            }}
          >
            Retry connection
          </Button>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

export function AuthRouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <AuthUnavailableScreen
      error={error instanceof Error ? error : new Error('Session verification failed')}
      onRetry={() => {
        void router.invalidate();
      }}
    />
  );
}
