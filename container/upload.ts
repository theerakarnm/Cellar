import { createHash } from "node:crypto";
import { JobError } from "./job";
import type { CompletedPart, S3Client } from "./s3";

const MiB = 1024 * 1024;
export const MIN_PART_BYTES = 5 * MiB;
export const MAX_PART_BYTES = 128 * MiB;
const MAX_PARTS = 10_000;

/**
 * Part size for a database of the given size. The request (32 MiB by default) wins unless the
 * dump could need more than ~9,500 parts. The 1.25 factor covers a dump bigger than the database.
 */
export function choosePartSize(requestedBytes: number, dbSizeBytes: number): number {
  const needed = Math.ceil((dbSizeBytes * 1.25) / (MAX_PARTS * 0.95) / MiB) * MiB;
  const size = Math.max(requestedBytes, MIN_PART_BYTES, needed);
  if (size > MAX_PART_BYTES) {
    throw new JobError("UPLOAD_FAILED", "Database is too large: the part size would exceed 128 MiB (about 1.2 TiB at 10,000 parts), the most the container memory can buffer");
  }
  return size;
}

export interface UploadResult {
  sizeBytes: number;
  sha256: string;
  partCount: number;
}

export interface UploadOptions {
  signal?: AbortSignal;
  /** Awaited after the source ends and before the last part is sent. Throw to abort the upload. */
  beforeComplete?: () => Promise<void>;
}

/**
 * Streams `source` to S3 as a multipart upload with one part buffer and one request in flight.
 * Peak memory is about one part. A failure at any point aborts the multipart upload.
 */
export async function uploadStream(
  source: AsyncIterable<Uint8Array>,
  s3: S3Client,
  key: string,
  partSize: number,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const hash = createHash("sha256");
  const parts: CompletedPart[] = [];
  const buffer = new Uint8Array(partSize);
  let filled = 0;
  let total = 0;
  const uploadId = await s3.createMultipart(key, options.signal);

  const sendPart = async () => {
    parts.push(await s3.uploadPart(key, uploadId, parts.length + 1, buffer.subarray(0, filled), options.signal));
    filled = 0;
  };

  try {
    for await (const chunk of source) {
      hash.update(chunk);
      total += chunk.length;
      for (let offset = 0; offset < chunk.length; ) {
        const take = Math.min(partSize - filled, chunk.length - offset);
        buffer.set(chunk.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === partSize) await sendPart();
      }
    }
    await options.beforeComplete?.();
    if (total === 0) throw new JobError("DUMP_FAILED", "The dump produced no data");
    if (filled > 0) await sendPart();
    await s3.completeMultipart(key, uploadId, parts, options.signal);
  } catch (error) {
    // Best effort. R2 also aborts incomplete uploads after 7 days by default.
    await s3.abortMultipart(key, uploadId).catch(() => undefined);
    throw error;
  }
  return { sizeBytes: total, sha256: hash.digest("hex"), partCount: parts.length };
}
