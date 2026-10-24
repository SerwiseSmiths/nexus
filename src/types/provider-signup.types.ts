import { DeviceType, ProviderSignupStatus } from '@prisma/client';

/** Public "Join Serwise" form body from serwise-website. */
export interface CreateProviderSignupBody {
  firstName: string;
  lastName: string;
  phoneNo: string;
  city: string;
  deviceTypes: DeviceType[];
  experienceYears?: number;
}

export type CreateProviderSignupInput = CreateProviderSignupBody;

/** Admin review from watchtower. */
export interface UpdateProviderSignupBody {
  status?: ProviderSignupStatus;
  adminNotes?: string | null;
}

export interface UpdateProviderSignupInput extends UpdateProviderSignupBody {
  id: string;
}

export interface ListProviderSignupInput {
  status?: ProviderSignupStatus;
}
