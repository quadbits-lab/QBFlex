import nodemailer from 'nodemailer';
import { render } from '@react-email/render';
import { Resend } from 'resend';
import { ResetPasswordEmail, VerifyEmailEmail } from './templates';
export type EmailKind = 'verify-email' | 'reset-password';
export interface Mailer {
  /** Delivers a branded React Email (Resend) with a plain-text URL fallback (SMTP/Mailpit). */
  send(to: string, kind: EmailKind, url: string): Promise<void>;
}
const subjects: Record<EmailKind, string> = {
  'verify-email': 'Verify your email',
  'reset-password': 'Reset your QB Flex password',
};
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
        const html = await render(
          kind === 'verify-email' ? (
            <VerifyEmailEmail url={url} />
          ) : (
            <ResetPasswordEmail url={url} />
          ),
        );
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
      const html = await render(
        kind === 'verify-email' ? <VerifyEmailEmail url={url} /> : <ResetPasswordEmail url={url} />,
      );
      await transport.sendMail({ from, to, subject, text: `${subject}\n\n${url}`, html });
    },
  };
}
