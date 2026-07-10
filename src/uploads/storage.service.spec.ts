import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

const sendMock = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
  PutObjectCommand: jest
    .fn()
    .mockImplementation((input: Record<string, unknown>) => ({ input })),
}));

function makeConfig(): ConfigService {
  const values: Record<string, unknown> = {
    'storage.bucket': 'maxihabana',
    'storage.publicUrl': 'http://localhost:9000/maxihabana',
    'storage.region': 'us-east-1',
    'storage.endpoint': 'http://localhost:9000',
    'storage.forcePathStyle': true,
    'storage.accessKeyId': 'key',
    'storage.secretAccessKey': 'secret',
  };
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

describe('StorageService', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
  });

  it('uploads a buffer and returns a public URL under the prefix', async () => {
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
});
