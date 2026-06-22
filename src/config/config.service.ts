import { Injectable } from '@nestjs/common';

export interface AppConfig {
  port: number;
  nodeEnv: string;
}

@Injectable()
export class ConfigService {
  private readonly config: AppConfig;

  constructor() {
    this.config = {
      port: parseInt(process.env.PORT ?? '3000', 10),
      nodeEnv: process.env.NODE_ENV ?? 'development',
    };
  }

  get<T extends keyof AppConfig>(key: T): AppConfig[T] {
    return this.config[key];
  }
}
