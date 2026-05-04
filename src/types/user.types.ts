export interface UploadAvatarBody {
  base64: string;
  mimeType: string;
}

export interface UpdateProfileBody {
  firstName: string;
  lastName: string;
  avatarUrl?: string;
}

export interface UpdateProfileInput {
  userId: string;
  firstName: string;
  lastName: string;
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
