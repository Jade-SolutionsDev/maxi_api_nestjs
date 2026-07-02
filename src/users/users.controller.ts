import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { ClerkUserAuthGuard } from '../auth/guards/clerk-user-auth.guard';
import { AdminGuard } from '../permissions/guards/admin.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { Invitation } from './entities/invitation.entity';
import { InvitationsService } from './invitations.service';
import { UsersService } from './users.service';
import { UserType } from './entities/user.entity';

@Controller('users')
@UseGuards(ClerkUserAuthGuard, AdminGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly invitationsService: InvitationsService,
  ) {}

  @Get()
  async findAll(
    @Query('q') q?: string,
    @Query('isActive') isActive?: string,
    @Query('userType') userType?: string,
    @Query('includeInvitations') includeInvitations?: string,
  ): Promise<UserResponseDto[]> {
    const filter = {
      q,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
      userType: userType as UserType | undefined,
      includeInvitations: includeInvitations === 'true',
    };
    const users = await this.usersService.findAll(filter);
    return users.map((user) => UserResponseDto.fromEntity(user, user.clerkId === null));
  }

  @Get('lookup')
  async findByClerkId(
    @Query('clerkId') clerkId: string,
  ): Promise<UserResponseDto | null> {
    const user = await this.usersService.findByClerkId(clerkId);
    return user ? UserResponseDto.fromEntity(user) : null;
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<UserResponseDto> {
    return UserResponseDto.fromEntity(await this.usersService.findOne(id));
  }

  @Post()
  async create(@Body() createUserDto: CreateUserDto): Promise<UserResponseDto> {
    return UserResponseDto.fromEntity(
      await this.usersService.create(createUserDto),
    );
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return UserResponseDto.fromEntity(
      await this.usersService.update(id, updateUserDto),
    );
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await this.usersService.remove(id);
  }

  @Post('invite')
  async invite(
    @Body() dto: InviteUserDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<Invitation> {
    return this.invitationsService.createAndSendInvitation(dto, request.user);
  }
}
