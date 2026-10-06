import { createFileRoute } from '@tanstack/react-router';
import { DocsPage } from '../components';
export const Route = createFileRoute('/')({
  component: () => <DocsPage slug="getting-started/introduction" />,
});
