import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ClerkLookupQueryDto } from '../common/dto/clerk-lookup-query.dto';
import { PaginatedResponse } from '../common/dto/pagination.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { InvitationResponseDto } from './dto/invitation-response.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { Role, User } from './entities/user.entity';
import { InvitationsService } from './invitations.service';
import { UsersService } from './users.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly invitationsService: InvitationsService,
  ) {}

  @Get()
  async findAll(
    @Query() query: ListUsersQueryDto,
  ): Promise<PaginatedResponse<UserResponseDto>> {
    const result = await this.usersService.findAll(
      {
        q: query.q,
        role: query.role,
        status: query.status,
        includeInvitations: query.includeInvitations,
        includeDeleted: query.includeDeleted,
      },
      query,
    );
    return {
      data: result.data.map((user) =>
        UserResponseDto.fromEntity(user, user.clerkId === null),
      ),
      meta: result.meta,
    };
  }

  @Get('lookup')
  async findByClerkId(
    @Query() query: ClerkLookupQueryDto,
  ): Promise<UserResponseDto | null> {
    const user = await this.usersService.findByClerkId(query.clerkId);
    return user ? UserResponseDto.fromEntity(user) : null;
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponseDto> {
    return UserResponseDto.fromEntity(await this.usersService.findOne(id));
  }

  @Post()
  async create(
    @Body() createUserDto: CreateUserDto,
    @CurrentUser() actor: User,
  ): Promise<UserResponseDto> {
    return UserResponseDto.fromEntity(
      await this.usersService.create(createUserDto, actor),
    );
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() actor: User,
  ): Promise<UserResponseDto> {
    return UserResponseDto.fromEntity(
      await this.usersService.update(id, updateUserDto, actor),
    );
  }

  @Patch(':id/password')
  async setPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPasswordDto,
    @CurrentUser() actor: User,
  ): Promise<void> {
    await this.usersService.setPassword(id, dto.password, actor);
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: User,
  ): Promise<void> {
    await this.usersService.remove(id, actor);
  }

  @Post(':id/restore')
  @Roles(Role.SUPER_ADMIN)
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponseDto> {
    return UserResponseDto.fromEntity(await this.usersService.restore(id));
  }

  @Post('invite')
  async invite(
    @Body() dto: InviteUserDto,
    @CurrentUser() actor: User,
  ): Promise<InvitationResponseDto> {
    return InvitationResponseDto.fromEntity(
      await this.invitationsService.createAndSendInvitation(dto, actor),
    );
  }

  @Post('invitations/:id/revoke')
  async revokeInvitation(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvitationResponseDto> {
    return InvitationResponseDto.fromEntity(
      await this.invitationsService.revoke(id),
    );
  }

  @Post('invitations/:id/resend')
  async resendInvitation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: User,
  ): Promise<InvitationResponseDto> {
    return InvitationResponseDto.fromEntity(
      await this.invitationsService.resend(id, actor),
    );
  }
}
