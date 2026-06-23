import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './update-user.dto';

describe('UpdateUserDto', () => {
  it('should validate an empty update payload', async () => {
    const dto = plainToInstance(UpdateUserDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should validate a partial update payload', async () => {
    const dto = plainToInstance(UpdateUserDto, {
      firstName: 'Updated',
      status: 'inactive',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject invalid password when provided', async () => {
    const dto = plainToInstance(UpdateUserDto, { password: 'weak' });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'password')).toBe(true);
  });

  it('should reject invalid email when provided', async () => {
    const dto = plainToInstance(UpdateUserDto, { email: 'bad-email' });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'email')).toBe(true);
  });
});
