import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  v2 as cloudinary,
  UploadApiErrorResponse,
  UploadApiResponse,
} from 'cloudinary';

// Content types accepted for image uploads -> file extension.
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export const ALLOWED_IMAGE_MIME_TYPES = Object.keys(IMAGE_EXTENSIONS);
export const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Image object-storage seam. The backend is chosen by STORAGE_DRIVER:
 *   - 's3' (default): S3-compatible — MinIO in local dev, AWS S3 in prod, etc.
 *   - 'cloudinary': Cloudinary (deployed). Credentials come from CLOUDINARY_URL,
 *     which the SDK reads from the environment.
 * Both paths return { url }, so nothing downstream cares which backend ran.
 *
 * ponytail: one `if` on the driver — there is a single upload method. Add a
 * provider interface only if a third backend appears.
 *
 * ponytail: objects uploaded then abandoned (form cancelled) are never
 * garbage-collected. Acceptable for now; add a sweep/lifecycle rule if it grows.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: string;
  // Populated for the S3 driver only.
  private readonly client?: S3Client;
  private readonly bucket?: string;
  private readonly publicUrl?: string;

  constructor(private readonly configService: ConfigService) {
    this.driver = this.configService.get<string>('storage.driver') ?? 's3';

    if (this.driver === 'cloudinary') {
      // Reads CLOUDINARY_URL from the environment; force https delivery URLs.
      cloudinary.config({ secure: true });
      return;
    }

    this.bucket =
      this.configService.get<string>('storage.bucket') ?? 'maxihabana';
    this.publicUrl = this.configService.get<string>('storage.publicUrl') ?? '';
    this.client = new S3Client({
      region: this.configService.get<string>('storage.region') ?? 'us-east-1',
      endpoint: this.configService.get<string>('storage.endpoint'),
      forcePathStyle:
        this.configService.get<boolean>('storage.forcePathStyle') ?? false,
      credentials: this.buildCredentials(),
      // MinIO (and most S3-compatible stores) reject the SDK's default flexible
      // checksums (x-amz-checksum-crc32 + aws-chunked trailer), which otherwise
      // makes PutObject fail. Only send/validate checksums when required.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  private buildCredentials() {
    const accessKeyId = this.configService.get<string>('storage.accessKeyId');
    const secretAccessKey = this.configService.get<string>(
      'storage.secretAccessKey',
    );
    // When unset, fall back to the default AWS credential chain (IAM role, etc.).
    return accessKeyId && secretAccessKey
      ? { accessKeyId, secretAccessKey }
      : undefined;
  }

  /** Store an image buffer and return its public URL. */
  async uploadImage(
    buffer: Buffer,
    mimeType: string,
    prefix: string,
  ): Promise<{ url: string }> {
    return this.driver === 'cloudinary'
      ? this.uploadToCloudinary(buffer, prefix)
      : this.uploadToS3(buffer, mimeType, prefix);
  }

  private async uploadToS3(
    buffer: Buffer,
    mimeType: string,
    prefix: string,
  ): Promise<{ url: string }> {
    const ext = IMAGE_EXTENSIONS[mimeType] ?? 'bin';
    const key = `${prefix}/${randomUUID()}.${ext}`;

    try {
      await this.client!.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        }),
      );
    } catch (error) {
      this.logger.error(
        `S3 upload failed for bucket "${this.bucket}" key "${key}"`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableException('Image storage is unavailable');
    }

    const url = `${this.publicUrl!.replace(/\/$/, '')}/${key}`;
    this.logger.debug(`Uploaded ${key} -> ${url}`);
    return { url };
  }

  private uploadToCloudinary(
    buffer: Buffer,
    prefix: string,
  ): Promise<{ url: string }> {
    return new Promise((resolve, reject) => {
      const upload = cloudinary.uploader.upload_stream(
        { folder: prefix, resource_type: 'image' },
        (
          error: UploadApiErrorResponse | undefined,
          result?: UploadApiResponse,
        ) => {
          if (error || !result) {
            this.logger.error(
              `Cloudinary upload failed for folder "${prefix}"`,
              error ? JSON.stringify(error) : 'no result returned',
            );
            reject(
              new ServiceUnavailableException('Image storage is unavailable'),
            );
            return;
          }
          this.logger.debug(`Uploaded -> ${result.secure_url}`);
          resolve({ url: result.secure_url });
        },
      );
      upload.end(buffer);
    });
  }
}
