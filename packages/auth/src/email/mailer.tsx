import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import nodemailer from 'nodemailer';
import { render } from '@react-email/render';
import { Resend } from 'resend';
import { ResetPasswordEmail, VerifyEmailEmail } from './templates';
export type EmailKind = 'verify-email' | 'reset-password' | 'magic-link';
export interface Mailer {
  /** Delivers a branded React Email (Resend) with a plain-text URL fallback (SMTP/Mailpit). */
  send(to: string, kind: EmailKind, url: string): Promise<void>;
}
const subjects: Record<EmailKind, string> = {
  'verify-email': 'Verify your email',
  'reset-password': 'Reset your QB Flex password',
  'magic-link': 'Sign in to QB Flex',
};
function MagicLinkEmail({ url }: { url: string }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Sign in to QB Flex</Preview>
      <Body
        style={{
          backgroundColor: '#f6f8fa',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          margin: '0',
          padding: '40px 0',
        }}
      >
        <Container
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            margin: '0 auto',
            maxWidth: '560px',
            padding: '32px 40px',
          }}
        >
          <Text
            style={{
              color: '#0f172a',
              fontSize: '14px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              margin: '0 0 24px',
              textTransform: 'uppercase',
            }}
          >
            QB Flex
          </Text>
          <Heading
            style={{ color: '#0f172a', fontSize: '22px', fontWeight: 600, margin: '0 0 12px' }}
          >
            Sign in to QB Flex
          </Heading>
          <Text style={{ color: '#334155', fontSize: '15px', lineHeight: '1.6', margin: '0 0 24px' }}>
            Use this one-time link to sign in. It expires shortly and works only once.
          </Text>
          <Section style={{ margin: '0 0 24px', textAlign: 'center' }}>
            <Button
              style={{
                backgroundColor: '#2563eb',
                borderRadius: '8px',
                color: '#ffffff',
                display: 'inline-block',
                fontSize: '15px',
                fontWeight: 600,
                padding: '12px 24px',
                textDecoration: 'none',
              }}
              href={url}
            >
              Sign in
            </Button>
          </Section>
          <Text
            style={{
              color: '#64748b',
              fontSize: '13px',
              lineHeight: '1.6',
              margin: '0 0 24px',
              wordBreak: 'break-all',
            }}
          >
            Or copy this link into your browser:{' '}
            <a href={url} style={{ color: '#2563eb' }}>
              {url}
            </a>
          </Text>
          <Hr style={{ borderColor: '#e2e8f0', margin: '0 0 16px' }} />
          <Text style={{ color: '#94a3b8', fontSize: '12px', lineHeight: '1.5', margin: '0' }}>
            If you did not request this email you can safely ignore it. Requesting a link always
            returns the same response and does not reveal whether an account exists.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
function emailElement(kind: EmailKind, url: string) {
  switch (kind) {
    case 'verify-email':
      return <VerifyEmailEmail url={url} />;
    case 'reset-password':
      return <ResetPasswordEmail url={url} />;
    case 'magic-link':
      return <MagicLinkEmail url={url} />;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
export function createMailer(): Mailer {
  const from = process.env.QB_MAIL_FROM ?? 'QB Flex <hello@localhost>';
  const resendKey = process.env.QB_RESEND_API_KEY;
  // QB_MAIL_PROVIDER: 'resend' | 'smtp' | 'auto' (default: Resend when a key exists, else SMTP).
  // Explicit selection keeps local Mailpit flows deterministic even with a Resend key present.
  const selection = process.env.QB_MAIL_PROVIDER ?? (resendKey ? 'resend' : 'smtp');
  const provider = selection === 'auto' ? (resendKey ? 'resend' : 'smtp') : selection;
  if (provider === 'resend' && !resendKey)
    throw new Error('QB_RESEND_API_KEY is required when QB_MAIL_PROVIDER=resend');
  if (provider === 'smtp' && !process.env.QB_SMTP_HOST && process.env.NODE_ENV === 'production')
    throw new Error('QB_SMTP_HOST is required for SMTP auth email in production');
  if (provider === 'resend') {
    const resend = new Resend(resendKey);
    return {
      async send(to: string, kind: EmailKind, url: string) {
        const subject = subjects[kind];
        const html = await render(emailElement(kind, url));
        const { error } = await resend.emails.send({
          from,
          to,
          subject,
          html,
          text: `${subject}\n\n${url}`,
        });
        if (error) throw new Error('Email delivery failed', { cause: error });
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: process.env.QB_SMTP_HOST ?? '127.0.0.1',
    port: Number(process.env.QB_SMTP_PORT ?? 1025),
    secure: process.env.QB_SMTP_SECURE === 'true',
    ...(process.env.QB_SMTP_USER
      ? { auth: { user: process.env.QB_SMTP_USER, pass: process.env.QB_SMTP_PASSWORD } }
      : {}),
  });
  return {
    async send(to: string, kind: EmailKind, url: string) {
      const subject = subjects[kind];
      const html = await render(emailElement(kind, url));
      await transport.sendMail({ from, to, subject, text: `${subject}\n\n${url}`, html });
    },
  };
}
