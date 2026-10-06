import { useCallback, useEffect, useState } from 'react';
import { notifyError, toast } from '@qb-flex/ui';
import { platformAuth } from './platform-auth';

export interface PlatformPasskey {
  id: string;
  name?: string | null;
  createdAt?: Date;
}

/**
 * Passkey inventory for the signed-in platform account. Better-auth exposes
 * list/delete/update through dedicated endpoints; the WebAuthn ceremony for
 * enrollment runs through the passkey client plugin.
 */
export function usePlatformPasskeys() {
  const [passkeys, setPasskeys] = useState<PlatformPasskey[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setPending(true);
    setError('');
    try {
      const result = await platformAuth.passkey.listUserPasskeys();
      if (result.error) throw new Error(result.error.message ?? 'Unable to list passkeys');
      setPasskeys(result.data ?? []);
    } catch (e) {
      const message = notifyError(e, 'Unable to list passkeys');
      setError(message);
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enroll = useCallback(
    async (name: string) => {
      setError('');
      setPending(true);
      try {
        const result = await platformAuth.passkey.addPasskey({ name });
        if (result.error) throw new Error(result.error.message ?? 'Passkey enrollment failed');
        await refresh();
        toast.success('Passkey enrolled');
        return true;
      } catch (e) {
        notifyError(e, 'Passkey enrollment failed');
        return false;
      } finally {
        setPending(false);
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      setError('');
      setPending(true);
      try {
        const result = await platformAuth.passkey.deletePasskey({ id });
        if (result.error) throw new Error(result.error.message ?? 'Unable to delete passkey');
        await refresh();
        toast.success('Passkey deleted');
        return true;
      } catch (e) {
        notifyError(e, 'Unable to delete passkey');
        return false;
      } finally {
        setPending(false);
      }
    },
    [refresh],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      setError('');
      setPending(true);
      try {
        const result = await platformAuth.passkey.updatePasskey({ id, name });
        if (result.error) throw new Error(result.error.message ?? 'Unable to rename passkey');
        await refresh();
        toast.success('Passkey renamed');
        return true;
      } catch (e) {
        notifyError(e, 'Unable to rename passkey');
        return false;
      } finally {
        setPending(false);
      }
    },
    [refresh],
  );

  return { passkeys, pending, error, enroll, remove, rename };
}
