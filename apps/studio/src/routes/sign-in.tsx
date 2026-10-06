import { createFileRoute } from '@tanstack/react-router';
import { SignInScreen } from '../auth-screen';
export const Route = createFileRoute('/sign-in')({ component: SignInScreen });
