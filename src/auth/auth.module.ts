import { Module } from '@nestjs/common';
import { GoogleModule } from '../integrations/google/google.module.js';
import { AuthController } from './auth.controller.js';
import { GoogleAccountsRepository } from './google-accounts.repository.js';
import { GoogleAuthService } from './google-auth.service.js';
import { OAuthStatesRepository } from './oauth-states.repository.js';

@Module({
  imports: [GoogleModule],
  controllers: [AuthController],
  providers: [GoogleAuthService, GoogleAccountsRepository, OAuthStatesRepository],
  exports: [GoogleAuthService],
})
export class AuthModule {}
