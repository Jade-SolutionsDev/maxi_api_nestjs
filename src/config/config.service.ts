import { Injectable } from '@nestjs/common';

export interface AppConfig {
  port: number;
  nodeEnv: string;
}

@Injectable()
export class ConfigService {
  private readonly config: AppConfig;

  constructor() {
    const rawPort = parseInt(process.env.PORT ?? '3000', 10);
    this.config = {
      port: Number.isNaN(rawPort) ? 3000 : rawPort,
      nodeEnv: process.env.NODE_ENV ?? 'development',
    };
  }

  get<T extends keyof AppConfig>(key: T): AppConfig[T] {
    return this.config[key];
  }
}
