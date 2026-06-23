import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

describe('CreateUserDto', () => {
  const validInput = {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: '+1234567890',
    userType: 'admin',
    status: 'active',
    password: 'SecurePass1',
  };

  it('should validate a correct payload', async () => {
    const dto = plainToInstance(CreateUserDto, validInput);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject invalid email', async () => {
    const dto = plainToInstance(CreateUserDto, {
      ...validInput,
      email: 'not-an-email',
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'email')).toBe(true);
  });

  it('should reject weak password without a number', async () => {
    const dto = plainToInstance(CreateUserDto, {
      ...validInput,
      password: 'SecurePass',
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'password')).toBe(true);
  });

  it('should reject short password', async () => {
    const dto = plainToInstance(CreateUserDto, {
      ...validInput,
      password: 'Short1',
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'password')).toBe(true);
  });

  it('should reject unknown userType', async () => {
    const dto = plainToInstance(CreateUserDto, {
      ...validInput,
      userType: 'superuser',
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'userType')).toBe(true);
  });
});
