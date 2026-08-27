import { DeviceType } from '@prisma/client';

export interface UploadAvatarBody {
  base64: string;
  mimeType: string;
}

export interface UpdateSkillsBody {
  skills: DeviceType[];
}

export interface UpdateSkillsInput extends UpdateSkillsBody {
  userId: string;
}

export interface UpdateProfileBody {
  firstName: string | null;
  lastName: string | null;
  avatarUrl?: string;
}

export interface UpdateProfileInput {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl?: string;
}

export interface UploadAvatarInput {
  base64: string;
  mimeType: string;
  userId: string;
}

export interface UpdateEmailInput {
  userId: string;
  email: string;
}

export interface ProviderAddressInput {
  houseNo?: string;
  addressLineOne?: string;
  addressLineTwo?: string;
  area?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  country?: string;
  latitude?: string;
  longitude?: string;
}

export interface BankAccountInput {
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  accountHolderName: string;
}

export interface CreateProviderBody {
  firstName: string;
  lastName: string;
  phoneNo: string;
  email?: string;
  skills?: DeviceType[];
  currentAddress?: ProviderAddressInput;
  aadharAddress?: ProviderAddressInput;
  adminNotes?: string;
  imageBase64?: string;
  imageMimeType?: string;
}

export interface CreateProviderInput extends CreateProviderBody {}

export interface UpdateProviderBody {
  firstName?: string;
  lastName?: string;
  phoneNo?: string;
  email?: string;
  skills?: DeviceType[];
  currentAddress?: ProviderAddressInput;
  aadharAddress?: ProviderAddressInput;
  adminNotes?: string;
  isActive?: boolean;
  imageBase64?: string;
  imageMimeType?: string;
  bankAccount?: BankAccountInput;
}

export interface UpdateProviderInput extends UpdateProviderBody {
  providerId: string;
}

export interface CreateCustomerBody {
  firstName: string;
  lastName: string;
  phoneNo: string;
  email?: string;
}

export interface CreateCustomerInput extends CreateCustomerBody {}

export interface UpdateCustomerBody {
  firstName?: string;
  lastName?: string;
  phoneNo?: string;
  email?: string;
}

export interface UpdateCustomerInput extends UpdateCustomerBody {
  customerId: string;
}
