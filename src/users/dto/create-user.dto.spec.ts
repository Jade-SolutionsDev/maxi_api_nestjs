import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

describe('CreateUserDto', () => {
  const validInput = {
    clerkId: 'clerk_user_1',
    userType: 'admin',
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '+1234567890',
  };

  it('should validate a correct payload', async () => {
    const dto = plainToInstance(CreateUserDto, validInput);
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should allow missing clerkId for admin/local users', async () => {
    const dto = plainToInstance(CreateUserDto, {
      ...validInput,
      clerkId: undefined,
    });
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

  it('should reject unknown userType', async () => {
    const dto = plainToInstance(CreateUserDto, {
      ...validInput,
      userType: 'customer',
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'userType')).toBe(true);
  });
});
