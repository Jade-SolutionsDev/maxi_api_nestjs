import { Test, TestingModule } from '@nestjs/testing';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserType } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let service: jest.Mocked<UsersService>;

  const user: UserResponseDto = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    clerkId: 'clerk_user_1',
    userType: UserType.ADMIN,
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: null,
    avatarUrl: null,
    businessName: null,
    businessDescription: null,
    businessLogoUrl: null,
    clerkOrgId: null,
    isActive: true,
    createdBy: null,
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
            findByClerkId: jest.fn(),
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

  it('should lookup a user by clerkId', async () => {
    service.findByClerkId.mockResolvedValue(user as unknown as never);
    const result = await controller.findByClerkId(user.clerkId);
    expect(result?.clerkId).toBe(user.clerkId);
  });

  it('should create a user', async () => {
    const createDto: CreateUserDto = {
      clerkId: 'clerk_user_2',
      email: 'jane@example.com',
      userType: UserType.ADMIN,
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
