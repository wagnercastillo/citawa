import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolve } from 'path';
import { dataSourceOptions } from './database/data-source';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: resolve(__dirname, '../../../.env') }),
    TypeOrmModule.forRoot(dataSourceOptions),
  ],
  controllers: [HealthController],
})
export class AppModule {}
