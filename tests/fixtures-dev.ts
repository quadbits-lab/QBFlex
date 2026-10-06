import { runDevelopment } from '../scripts/dev';

try {
  await runDevelopment({
    ports: JSON.parse(process.env.QB_TEST_DEV_PORTS!),
    startupTimeoutMs: Number(process.env.QB_TEST_DEV_TIMEOUT ?? 10000),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Development startup failed.');
  process.exitCode = 1;
}
