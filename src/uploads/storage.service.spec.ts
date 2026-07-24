import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

const sendMock = jest.fn();
const uploadStreamMock = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
  PutObjectCommand: jest
    .fn()
    .mockImplementation((input: Record<string, unknown>) => ({ input })),
}));

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: (
        opts: Record<string, unknown>,
        cb: (err: unknown, res: { secure_url: string }) => void,
      ) => {
        uploadStreamMock(opts);
        return {
          end: () =>
            cb(undefined, {
              secure_url:
                'https://res.cloudinary.com/demo/image/upload/taxonomy/x.png',
            }),
        };
      },
    },
  },
}));

function makeConfig(driver?: string): ConfigService {
  const values: Record<string, unknown> = {
    'storage.bucket': 'maxihabana',
    'storage.publicUrl': 'http://localhost:9000/maxihabana',
    'storage.region': 'us-east-1',
    'storage.endpoint': 'http://localhost:9000',
    'storage.forcePathStyle': true,
    'storage.accessKeyId': 'key',
    'storage.secretAccessKey': 'secret',
  };
  if (driver) values['storage.driver'] = driver;
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

describe('StorageService', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
    uploadStreamMock.mockReset();
  });

  it('uploads a buffer and returns a public URL under the prefix (s3)', async () => {
    const service = new StorageService(makeConfig());

    const { url } = await service.uploadImage(
      Buffer.from('img'),
      'image/png',
      'taxonomy',
    );

    expect(url).toMatch(
      /^http:\/\/localhost:9000\/maxihabana\/taxonomy\/[0-9a-f-]+\.png$/,
    );
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as {
      input: { Bucket: string; ContentType: string; Key: string };
    };
    expect(command.input.Bucket).toBe('maxihabana');
    expect(command.input.ContentType).toBe('image/png');
    expect(command.input.Key).toMatch(/^taxonomy\/[0-9a-f-]+\.png$/);
  });

  it('uploads via Cloudinary and returns the secure_url when driver is cloudinary', async () => {
    const service = new StorageService(makeConfig('cloudinary'));

    const { url } = await service.uploadImage(
      Buffer.from('img'),
      'image/png',
      'taxonomy',
    );

    expect(url).toBe(
      'https://res.cloudinary.com/demo/image/upload/taxonomy/x.png',
    );
    expect(uploadStreamMock).toHaveBeenCalledTimes(1);
    expect(uploadStreamMock.mock.calls[0][0]).toMatchObject({
      folder: 'taxonomy',
    });
    // S3 path must not run when the cloudinary driver is selected.
    expect(sendMock).not.toHaveBeenCalled();
  });
});
