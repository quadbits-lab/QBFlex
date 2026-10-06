import { test, expect } from 'bun:test';
import { fixture } from '../helpers';
const integration = process.env.QB_INTEGRATION_STORAGE === '1' ? test : test.skip;
integration(
  'Mailpit verification and password reset callbacks work without a publishable header and revoke sessions',
  async () => {
    const f = await fixture();
    try {
      const project = await f.project('email-workflow'),
        email = 'mail-' + crypto.randomUUID() + '@example.com';
      const config = await f.call(
        '/management/v1/projects/' + project.id + '/config',
        'GET',
        undefined,
        f.token,
      );
      await f.call(
        '/management/v1/projects/' + project.id + '/config',
        'PUT',
        { verifyEmail: true },
        f.token,
        { 'if-match': String(config.data.version) },
      );
      expect(
        await project.client.auth.signUp({
          name: 'Mail test',
          email,
          password: 'original-password-12345',
        }),
      ).toBeNull();
      async function message(subject: string) {
        for (let attempt = 0; attempt < 30; attempt++) {
          const list = (await (
            await fetch(
              (process.env.QB_MAILPIT_URL ?? 'http://localhost:7616') + '/api/v1/messages',
            )
          ).json()) as any;
          const item = list.messages.find(
            (item: any) =>
              item.Subject.includes(subject) && item.To.some((to: any) => to.Address === email),
          );
          if (item)
            return (await (
              await fetch(
                (process.env.QB_MAILPIT_URL ?? 'http://localhost:7616') +
                  '/api/v1/message/' +
                  item.ID,
              )
            ).json()) as any;
          await Bun.sleep(100);
        }
        throw new Error('Expected local email was not delivered');
      }
      const verification = await message('Verify');
      const verifyURL = new URL(verification.Text.match(/https?:\/\/\S+/)[0]);
      verifyURL.host = new URL(f.url).host;
      const verified = await fetch(verifyURL, { redirect: 'manual' });
      expect([200, 302, 303]).toContain(verified.status);
      await project.client.auth.signIn({ email, password: 'original-password-12345' });
      const oldToken = project.client.getToken()!;
      await project.client.auth.resetPassword(email, 'http://localhost:7617/reset');
      const reset = await message('Reset');
      const resetURL = new URL(reset.Text.match(/https?:\/\/\S+/)[0]);
      const token = resetURL.pathname.split('/').at(-1)!;
      resetURL.host = new URL(f.url).host;
      expect([200, 302, 303]).toContain((await fetch(resetURL, { redirect: 'manual' })).status);
      await project.client.auth.updatePassword(token, 'replacement-password-12345');
      const session = await f.call(
        `/v1/projects/${project.id}/branches/primary/auth/get-session`,
        'GET',
        undefined,
        oldToken,
        { 'x-qb-key': project.key },
      );
      expect(session).toBeNull();
      expect(
        (await project.client.auth.signIn({ email, password: 'replacement-password-12345' })).user
          .email,
      ).toBe(email);
      await expect(
        project.client.auth.signIn({ email, password: 'original-password-12345' }),
      ).rejects.toMatchObject({ status: 401 });
      project.client.dispose();
    } finally {
      await f.close();
    }
  },
  20000,
);
