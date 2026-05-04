import { v2 as cloudinary } from 'cloudinary';
import { config } from '@/configs';

export const initializeCloudinary = () => {
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
  });
  return cloudinary;
};

export { cloudinary };
