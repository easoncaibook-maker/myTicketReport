import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/decorators';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.list(user.id, query);
  }

  @Get('unread-count')
  unread(@CurrentUser() user: AuthUser) {
    return this.service.unreadCount(user.id);
  }

  @Post('read-all')
  readAll(@CurrentUser() user: AuthUser) {
    return this.service.markAllRead(user.id);
  }

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.markRead(id, user.id);
  }
}
