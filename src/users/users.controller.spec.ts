import { Test, TestingModule } from '@nestjs/testing';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserStatus, UserType } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let service: jest.Mocked<UsersService>;

  const user: UserResponseDto = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    clerkUserId: null,
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: null,
    userType: UserType.ADMIN,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get(UsersService);
  });

  it('should list users', async () => {
    service.findAll.mockResolvedValue([user as unknown as never]);
    const result = await controller.findAll();
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe(user.email);
  });

  it('should get a user by id', async () => {
    service.findOne.mockResolvedValue(user as unknown as never);
    const result = await controller.findOne(user.id);
    expect(result.id).toBe(user.id);
  });

  it('should create a user', async () => {
    const createDto: CreateUserDto = {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      userType: UserType.ADMIN,
      status: UserStatus.ACTIVE,
      password: 'SecurePass1',
    };
    service.create.mockResolvedValue(user as unknown as never);
    const result = await controller.create(createDto);
    expect(result.email).toBe(createDto.email);
  });

  it('should update a user', async () => {
    const updateDto: UpdateUserDto = { firstName: 'Janet' };
    service.update.mockResolvedValue({
      ...user,
      firstName: 'Janet',
    } as unknown as never);
    const result = await controller.update(user.id, updateDto);
    expect(result.firstName).toBe('Janet');
  });

  it('should remove a user', async () => {
    service.remove.mockResolvedValue(undefined);
    await controller.remove(user.id);
    expect(service.remove).toHaveBeenCalledWith(user.id);
  });
});
