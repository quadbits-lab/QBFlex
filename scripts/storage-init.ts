import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { resolveS3Endpoint } from '../packages/storage/src/index.ts';
const endpoint = resolveS3Endpoint(process.env.QB_S3_ENDPOINT);
if (!endpoint) {
  console.log('QB_S3_ENDPOINT is not configured; skipping object bucket provisioning.');
  process.exit(0);
}
const client = new S3Client({
  endpoint,
  region: process.env.QB_S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  ...(process.env.QB_S3_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.QB_S3_ACCESS_KEY,
          secretAccessKey: process.env.QB_S3_SECRET_KEY!,
        },
      }
    : {}),
});
const Bucket = process.env.QB_S3_BUCKET ?? 'qb-flex';
try {
  await client.send(new HeadBucketCommand({ Bucket }));
} catch (error) {
  if ((error as any).$metadata?.httpStatusCode !== 404)
    throw new Error('Object backend unavailable or credentials denied');
  await client.send(new CreateBucketCommand({ Bucket }));
}
console.log(`Object backend bucket "${Bucket}" is ready.`);
