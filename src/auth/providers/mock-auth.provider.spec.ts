import { UnauthorizedException } from '@nestjs/common';
import { MockAuthProvider } from './mock-auth.provider';

describe('MockAuthProvider', () => {
  const provider = new MockAuthProvider();

  it('resolves the clerkId from a mock:<id> token', async () => {
    await expect(provider.verifyToken('mock:user_123')).resolves.toEqual({
      sub: 'user_123',
    });
  });

  it('also accepts the mock-<id> form', async () => {
    await expect(provider.verifyToken('mock-user_abc')).resolves.toEqual({
      sub: 'user_abc',
    });
  });

  it('rejects a non-mock token', () => {
    expect(() => provider.verifyToken('garbage')).toThrow(
      UnauthorizedException,
    );
  });
});
