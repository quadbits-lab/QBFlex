import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
const client = new S3Client({
  endpoint: process.env.QB_S3_ENDPOINT ?? 'http://localhost:7613',
  region: process.env.QB_S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.QB_S3_ACCESS_KEY ?? 'qbflex-local',
    secretAccessKey: process.env.QB_S3_SECRET_KEY ?? 'qbflex-local-development',
  },
});
const Bucket = process.env.QB_S3_BUCKET ?? 'qb-flex';
try {
  await client.send(new HeadBucketCommand({ Bucket }));
} catch (error) {
  if ((error as any).$metadata?.httpStatusCode !== 404)
    throw new Error('Object backend unavailable or credentials denied');
  await client.send(new CreateBucketCommand({ Bucket }));
}
console.log('Private object backend bucket is ready.');
