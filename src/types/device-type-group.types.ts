import type { DeviceType } from '@prisma/client';

export interface CreateDeviceTypeGroupBody {
  name: string;
  deviceTypes: DeviceType[];
}

export interface CreateDeviceTypeGroupInput extends CreateDeviceTypeGroupBody {}

export interface UpdateDeviceTypeGroupBody {
  name?: string;
  deviceTypes?: DeviceType[];
}

export interface UpdateDeviceTypeGroupInput extends UpdateDeviceTypeGroupBody {
  key: string;
}
