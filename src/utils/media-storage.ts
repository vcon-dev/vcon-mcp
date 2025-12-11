/**
 * Media Storage Utility for vCon Dialog Externalization
 *
 * Provides functionality to:
 * - Detect embedded media in vCon dialogs (base64-encoded recordings)
 * - Upload media to S3 with content-type detection
 * - Generate presigned URLs for secure access
 * - Update dialog objects to use external URLs
 *
 * Per IETF vcon-core-01 spec:
 * - Dialog content can be inline (body + encoding) or external (url + content_hash)
 * - HTTPS MUST be used for retrieval to protect privacy
 * - content_hash SHOULD be provided for integrity verification
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'crypto';
import type { Dialog, Encoding } from '../types/vcon.js';

/**
 * Media types that indicate embedded recordings
 */
const MEDIA_MIMETYPES = [
  'audio/',
  'video/',
  'application/ogg',
  'application/octet-stream'
];

/**
 * Configuration for media storage
 */
export interface MediaStorageConfig {
  /** S3 bucket for media storage */
  bucket: string;
  /** Optional prefix for S3 keys (e.g., 'media/' or 'recordings/') */
  prefix?: string;
  /** AWS region */
  region?: string;
  /** Presigned URL expiration in seconds (default: 7 days) */
  presignedUrlExpiration?: number;
  /** Whether to generate presigned URLs (true) or use direct S3 URLs (false) */
  usePresignedUrls?: boolean;
}

/**
 * Result of media externalization
 */
export interface MediaExternalizationResult {
  /** The updated dialog with url instead of body */
  dialog: Dialog;
  /** Whether media was externalized */
  externalized: boolean;
  /** S3 key where media was stored */
  s3Key?: string;
  /** Size of the media in bytes */
  sizeBytes?: number;
  /** Error message if externalization failed */
  error?: string;
}

/**
 * Options for processing dialogs with embedded media
 */
export interface MediaProcessingOptions {
  /** How to handle embedded media */
  mediaHandling: 'keep' | 'strip' | 'externalize';
  /** S3 configuration (required if mediaHandling is 'externalize') */
  s3Config?: MediaStorageConfig;
  /** S3 client instance (optional, will be created if not provided) */
  s3Client?: S3Client;
  /** Minimum size in bytes to consider for externalization (default: 1024) */
  minSizeBytes?: number;
}

/**
 * Check if a dialog contains embedded media that should be externalized
 */
export function hasEmbeddedMedia(dialog: Dialog): boolean {
  // Must have body and base64/base64url encoding
  if (
    !dialog.body ||
    (dialog.encoding !== 'base64' && dialog.encoding !== 'base64url')
  ) {
    return false;
  }

  // Must be a recording type
  if (dialog.type !== 'recording') {
    return false;
  }

  // Check mediatype if present
  if (dialog.mediatype) {
    return MEDIA_MIMETYPES.some(prefix => dialog.mediatype!.startsWith(prefix));
  }

  // If no mediatype but has base64url body in a recording dialog, assume it's media
  return true;
}

/**
 * Estimate the size of base64-encoded content in bytes
 */
export function estimateBase64Size(base64String: string): number {
  // Remove padding
  const padding = (base64String.match(/=/g) || []).length;
  // Base64 encodes 3 bytes in 4 characters
  return Math.floor((base64String.length * 3) / 4) - padding;
}

/**
 * Decode base64url to Buffer
 */
export function decodeBase64Url(base64url: string): Buffer {
  // Convert base64url to standard base64
  let base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  // Add padding if needed
  while (base64.length % 4) {
    base64 += '=';
  }

  return Buffer.from(base64, 'base64');
}

/**
 * Compute SHA-256 hash of content (for content_hash field)
 */
export function computeContentHash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Get file extension from mediatype
 */
function getExtensionFromMediatype(mediatype: string): string {
  const typeMap: Record<string, string> = {
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/x-mp3': 'mp3',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'video/mp4': 'mp4',
    'video/x-mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
    'video/quicktime': 'mov',
    'application/ogg': 'ogg',
  };

  return typeMap[mediatype] || mediatype.split('/')[1] || 'bin';
}

/**
 * Media Storage class for handling S3 uploads and presigned URLs
 */
export class MediaStorage {
  private s3Client: S3Client;
  private config: Required<MediaStorageConfig>;

  constructor(config: MediaStorageConfig, s3Client?: S3Client) {
    this.config = {
      bucket: config.bucket,
      prefix: config.prefix || 'media/',
      region: config.region || process.env.AWS_REGION || 'us-east-1',
      presignedUrlExpiration: config.presignedUrlExpiration || 7 * 24 * 60 * 60, // 7 days
      usePresignedUrls: config.usePresignedUrls ?? true,
    };

    this.s3Client = s3Client || new S3Client({ region: this.config.region });
  }

  /**
   * Generate S3 key for a dialog's media content
   */
  generateS3Key(vconUuid: string, dialogIndex: number, mediatype?: string, filename?: string): string {
    const ext = filename
      ? filename.split('.').pop() || 'bin'
      : mediatype
        ? getExtensionFromMediatype(mediatype)
        : 'bin';

    // Use date-based partitioning for efficient storage
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    return `${this.config.prefix}${year}/${month}/${day}/${vconUuid}/dialog-${dialogIndex}.${ext}`;
  }

  /**
   * Upload media content to S3
   */
  async uploadMedia(
    content: Buffer,
    s3Key: string,
    mediatype?: string
  ): Promise<{ url: string; contentHash: string }> {
    const contentHash = computeContentHash(content);

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: s3Key,
      Body: content,
      ContentType: mediatype || 'application/octet-stream',
      // Add metadata for integrity verification
      Metadata: {
        'content-hash': contentHash,
      },
    });

    await this.s3Client.send(command);

    // Generate URL
    let url: string;
    if (this.config.usePresignedUrls) {
      url = await this.generatePresignedUrl(s3Key);
    } else {
      url = `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${s3Key}`;
    }

    return { url, contentHash };
  }

  /**
   * Generate a presigned URL for accessing media
   */
  async generatePresignedUrl(s3Key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: s3Key,
    });

    return getSignedUrl(this.s3Client, command, {
      expiresIn: this.config.presignedUrlExpiration,
    });
  }

  /**
   * Externalize a dialog's embedded media to S3
   */
  async externalizeDialog(
    dialog: Dialog,
    vconUuid: string,
    dialogIndex: number
  ): Promise<MediaExternalizationResult> {
    if (!hasEmbeddedMedia(dialog)) {
      return { dialog, externalized: false };
    }

    try {
      // Decode the base64url content
      const content = decodeBase64Url(dialog.body!);
      const sizeBytes = content.length;

      // Generate S3 key
      const s3Key = this.generateS3Key(vconUuid, dialogIndex, dialog.mediatype, dialog.filename);

      // Upload to S3
      const { url, contentHash } = await this.uploadMedia(content, s3Key, dialog.mediatype);

      // Create updated dialog with URL instead of body
      const updatedDialog: Dialog = {
        ...dialog,
        url,
        content_hash: contentHash,
      };

      // Remove body and encoding (now external)
      delete updatedDialog.body;
      delete updatedDialog.encoding;

      return {
        dialog: updatedDialog,
        externalized: true,
        s3Key,
        sizeBytes,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        dialog,
        externalized: false,
        error: `Failed to externalize media: ${errorMsg}`,
      };
    }
  }
}

/**
 * Process dialogs according to media handling options
 *
 * @param dialogs - Array of dialog objects to process
 * @param vconUuid - UUID of the vCon containing these dialogs
 * @param options - Media processing options
 * @returns Processed dialogs and statistics
 */
export async function processDialogsForMedia(
  dialogs: Dialog[] | undefined,
  vconUuid: string,
  options: MediaProcessingOptions
): Promise<{
  dialogs: Dialog[];
  stats: {
    total: number;
    withEmbeddedMedia: number;
    stripped: number;
    externalized: number;
    externalizedBytes: number;
    errors: string[];
  };
}> {
  const stats = {
    total: dialogs?.length || 0,
    withEmbeddedMedia: 0,
    stripped: 0,
    externalized: 0,
    externalizedBytes: 0,
    errors: [] as string[],
  };

  if (!dialogs || dialogs.length === 0) {
    return { dialogs: [], stats };
  }

  const minSize = options.minSizeBytes ?? 1024;
  const processedDialogs: Dialog[] = [];

  // Create MediaStorage if externalizing
  let mediaStorage: MediaStorage | undefined;
  if (options.mediaHandling === 'externalize' && options.s3Config) {
    mediaStorage = new MediaStorage(options.s3Config, options.s3Client);
  }

  for (let i = 0; i < dialogs.length; i++) {
    const dialog = dialogs[i];

    if (!hasEmbeddedMedia(dialog)) {
      processedDialogs.push(dialog);
      continue;
    }

    stats.withEmbeddedMedia++;
    const estimatedSize = estimateBase64Size(dialog.body!);

    // Skip small media files
    if (estimatedSize < minSize) {
      processedDialogs.push(dialog);
      continue;
    }

    switch (options.mediaHandling) {
      case 'keep':
        processedDialogs.push(dialog);
        break;

      case 'strip':
        // Remove body but keep metadata
        const strippedDialog: Dialog = { ...dialog };
        delete strippedDialog.body;
        delete strippedDialog.encoding;
        processedDialogs.push(strippedDialog);
        stats.stripped++;
        break;

      case 'externalize':
        if (mediaStorage) {
          const result = await mediaStorage.externalizeDialog(dialog, vconUuid, i);
          processedDialogs.push(result.dialog);

          if (result.externalized) {
            stats.externalized++;
            stats.externalizedBytes += result.sizeBytes || 0;
          } else if (result.error) {
            stats.errors.push(`Dialog ${i}: ${result.error}`);
            // Keep original dialog on error
          }
        } else {
          stats.errors.push(`Dialog ${i}: S3 config not provided for externalization`);
          processedDialogs.push(dialog);
        }
        break;
    }
  }

  return { dialogs: processedDialogs, stats };
}
