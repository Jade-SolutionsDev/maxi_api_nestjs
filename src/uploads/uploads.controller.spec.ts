import { BadRequestException } from '@nestjs/common';
import { MAX_IMAGE_SIZE_BYTES, StorageService } from './storage.service';
import { UploadsController } from './uploads.controller';

function makeFile(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'img.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 1000,
    buffer: Buffer.from('img'),
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
}

describe('UploadsController', () => {
  let controller: UploadsController;
  let storage: { uploadImage: jest.Mock };

  beforeEach(() => {
    storage = { uploadImage: jest.fn() };
    controller = new UploadsController(storage as unknown as StorageService);
  });

  it('rejects when no file is provided', async () => {
    await expect(controller.uploadImage(undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a file over the size limit', async () => {
    const big = makeFile({ size: MAX_IMAGE_SIZE_BYTES + 1 });
    await expect(controller.uploadImage(big)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.uploadImage).not.toHaveBeenCalled();
  });

  it('delegates a valid file to the storage service', async () => {
    storage.uploadImage.mockResolvedValue({ url: 'http://cdn/x.png' });
    const result = await controller.uploadImage(makeFile());

    expect(result).toEqual({ url: 'http://cdn/x.png' });
    expect(storage.uploadImage).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/png',
      'taxonomy',
    );
  });
});
