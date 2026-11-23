import { Module } from '@nestjs/common';
import { GoogleCalendarClient } from './google-calendar.client.js';
import { GoogleOAuthClient } from './google-oauth.client.js';

@Module({
  providers: [GoogleOAuthClient, GoogleCalendarClient],
  exports: [GoogleOAuthClient, GoogleCalendarClient],
})
export class GoogleModule {}
