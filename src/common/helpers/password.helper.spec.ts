import { comparePassword, hashPassword } from './password.helper';

describe('password helper', () => {
  it('should hash a password', async () => {
    const hashed = await hashPassword('Secret123');
    expect(hashed).not.toBe('Secret123');
    expect(hashed.startsWith('$2')).toBe(true);
  });

  it('should return true for matching passwords', async () => {
    const hashed = await hashPassword('Secret123');
    await expect(comparePassword('Secret123', hashed)).resolves.toBe(true);
  });

  it('should return false for non-matching passwords', async () => {
    const hashed = await hashPassword('Secret123');
    await expect(comparePassword('WrongPassword', hashed)).resolves.toBe(false);
  });
});
