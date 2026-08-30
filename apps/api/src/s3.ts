// Shared S3/MinIO client, reused by the tape store (screenshots) and the home
// archive store (tarballs). All requests are bounded so a wedged MinIO cannot
// hang the API.

import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

export const BUCKET = process.env.S3_BUCKET ?? "webmcp-computer";

export const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "",
  },
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 3_000,
    requestTimeout: 60_000,
  }),
});
