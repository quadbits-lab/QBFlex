import { createFileRoute } from '@tanstack/react-router';
import { SetupScreen } from '../auth-screen';
export const Route = createFileRoute('/setup')({ component: SetupScreen });
