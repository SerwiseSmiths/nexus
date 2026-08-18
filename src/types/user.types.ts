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
