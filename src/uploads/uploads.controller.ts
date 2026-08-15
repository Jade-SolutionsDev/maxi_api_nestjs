import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  StorageService,
} from './storage.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

// Backoffice roles that manage the taxonomy and product catalog upload images.
@ApiTags('uploads')
@ApiBearerAuth()
@Controller('uploads')
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.KARDIST)
export class UploadsController {
  constructor(private readonly storageService: StorageService) {}

  @Post('image')
  @UseInterceptors(
    // No `storage` option → multer keeps the file in memory (file.buffer).
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
          cb(
            new BadRequestException(
              `Unsupported image type "${file.mimetype}"`,
            ),
            false,
          );
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('prefix') prefix?: string,
  ): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new BadRequestException('Image exceeds the 2MB limit');
    }
    // Storage folder allowlist: an arbitrary prefix would let a client write
    // anywhere in the bucket namespace. Default keeps the historical folder.
    const folder = prefix ?? 'taxonomy';
    if (!['taxonomy', 'cms'].includes(folder)) {
      throw new BadRequestException(`Unsupported prefix "${prefix}"`);
    }
    return this.storageService.uploadImage(file.buffer, file.mimetype, folder);
  }
}
