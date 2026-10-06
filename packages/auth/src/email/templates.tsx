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

export interface EmailTemplateProps {
  url: string;
}

const styles = {
  body: {
    backgroundColor: '#f6f8fa',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    margin: '0',
    padding: '40px 0',
  },
  container: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    border: '1px solid #e2e8f0',
    margin: '0 auto',
    maxWidth: '560px',
    padding: '32px 40px',
  },
  brand: {
    color: '#0f172a',
    fontSize: '14px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    margin: '0 0 24px',
    textTransform: 'uppercase' as const,
  },
  heading: {
    color: '#0f172a',
    fontSize: '22px',
    fontWeight: 600,
    lineHeight: '1.3',
    margin: '0 0 12px',
  },
  paragraph: {
    color: '#334155',
    fontSize: '15px',
    lineHeight: '1.6',
    margin: '0 0 24px',
  },
  section: { margin: '0 0 24px', textAlign: 'center' as const },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: '8px',
    color: '#ffffff',
    display: 'inline-block',
    fontSize: '15px',
    fontWeight: 600,
    padding: '12px 24px',
    textDecoration: 'none',
  },
  linkFallback: {
    color: '#64748b',
    fontSize: '13px',
    lineHeight: '1.6',
    margin: '0 0 24px',
    wordBreak: 'break-all' as const,
  },
  divider: { borderColor: '#e2e8f0', margin: '0 0 16px' },
  footer: {
    color: '#94a3b8',
    fontSize: '12px',
    lineHeight: '1.5',
    margin: '0',
  },
};

function Shell({
  preview,
  heading,
  description,
  ctaLabel,
  url,
}: {
  preview: string;
  heading: string;
  description: string;
  ctaLabel: string;
  url: string;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.brand}>QB Flex</Text>
          <Heading style={styles.heading}>{heading}</Heading>
          <Text style={styles.paragraph}>{description}</Text>
          <Section style={styles.section}>
            <Button style={styles.button} href={url}>
              {ctaLabel}
            </Button>
          </Section>
          <Text style={styles.linkFallback}>
            Or copy this link into your browser:{' '}
            <a href={url} style={{ color: '#2563eb' }}>
              {url}
            </a>
          </Text>
          <Hr style={styles.divider} />
          <Text style={styles.footer}>
            If you did not request this email you can safely ignore it; the link only works with
            its one-time token.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function VerifyEmailEmail({ url }: EmailTemplateProps) {
  return (
    <Shell
      preview="Verify your email address"
      heading="Verify your email"
      description="Confirm this address to activate email-verified sign-in for your QB Flex projects."
      ctaLabel="Verify email"
      url={url}
    />
  );
}

export function ResetPasswordEmail({ url }: EmailTemplateProps) {
  return (
    <Shell
      preview="Reset your QB Flex password"
      heading="Reset your password"
      description="Choose a new password with this link. Sessions on other devices are revoked after the reset."
      ctaLabel="Reset password"
      url={url}
    />
  );
}
