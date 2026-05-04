import { cloudinary } from '@/configs/cloudinary.config';
import { ApiError } from '@/utils/apiResponse';

export class UploadService {
  static async uploadAvatar(base64: string, mimeType: string, userId: string): Promise<string> {
    const dataUri = `data:${mimeType};base64,${base64}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: 'serwise/avatars',
      public_id: `user_${userId}`,
      overwrite: true,
      transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
    });

    if (!result.secure_url) {
      throw new ApiError(500, 'Failed to upload image');
    }

    return result.secure_url;
  }
}
