import { Request } from 'express';

export enum AppContext {
  SERWISE_APP = 'serwise-app',
  RADIX_APP = 'radix-app',
  SERWISE_WEBSITE = 'serwise-website',
  WATCHTOWER = 'watchtower',
}

export interface AppContextRequest extends Request {
  appContext?: AppContext;
}
