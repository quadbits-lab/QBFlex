import { createAuthClient } from 'better-auth/client';
import { twoFactorClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';
import { apiURL } from './api';

/**
 * Platform (Studio) auth client: better-auth ceremonies for passkey
 * enrollment/sign-in plus two-factor helpers. Cookie sessions are used for
 * platform requests; no bearer token is stored client-side.
 */
export const platformAuth = createAuthClient({
  baseURL: apiURL + '/platform/auth',
  plugins: [passkeyClient(), twoFactorClient()],
});
