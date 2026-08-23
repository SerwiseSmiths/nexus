import { Response, NextFunction } from 'express';
import { DeviceType } from '@prisma/client';
import { AuthRequest } from '@/middlewares/auth.middleware';
import { UserService } from '@/services/user.service';
import { AddressService, type CreateAddressInput, type UpdateAddressInput } from '@/services/address.service';
import { ApiResponse } from '@/utils/apiResponse';
import type {
  UploadAvatarBody,
  UpdateProfileBody,
  UpdateSkillsBody,
  CreateProviderBody,
  UpdateProviderBody,
  UpdateCustomerBody,
} from '@/types/user.types';

interface UpdateEmailBody { email: string; }

export class UserController {
  static async uploadAvatar(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { base64, mimeType } = req.body as UploadAvatarBody;
      if (!base64 || !mimeType) {
        return ApiResponse.error(res, 400, 'base64 and mimeType are required');
      }

      const avatarUrl = await UserService.uploadAvatar({
        base64,
        mimeType,
        userId: req.user!.id,
      });

      return ApiResponse.success(res, 200, 'Avatar uploaded successfully', { avatarUrl });
    } catch (error) {
      next(error);
    }
  }

  static async updateProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { firstName, lastName, avatarUrl } = req.body as UpdateProfileBody;

      const user = await UserService.updateProfile({
        userId: req.user!.id,
        firstName,
        lastName,
        avatarUrl,
      });

      return ApiResponse.success(res, 200, 'Profile updated successfully', { user });
    } catch (error) {
      next(error);
    }
  }

  static async updateEmail(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { email } = req.body as UpdateEmailBody;
      const user = await UserService.updateEmail({ userId: req.user!.id, email });
      return ApiResponse.success(res, 200, 'Email updated successfully', { user });
    } catch (error) {
      next(error);
    }
  }

  static async getProfile(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await UserService.getProfile(req.user!.id);
      return ApiResponse.success(res, 200, 'Profile fetched successfully', { user });
    } catch (error) {
      next(error);
    }
  }

  static async getSelf(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const flags = {
        address: req.query.address === 'true',
      };
      const user = await UserService.getSelf(req.user!.id, flags);
      return ApiResponse.success(res, 200, 'User fetched successfully', { user });
    } catch (error) {
      next(error);
    }
  }

  static async listProviders(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const search = req.query.search as string | undefined;
      const deviceType = req.query.deviceType as DeviceType | undefined;

      if (req.query.withStats === 'true') {
        const providers = await UserService.listProvidersWithStats(search);
        return ApiResponse.success(res, 200, 'Providers fetched successfully', { providers });
      }

      const providers = await UserService.listProviders(search, deviceType);
      return ApiResponse.success(res, 200, 'Providers fetched successfully', { providers });
    } catch (error) {
      next(error);
    }
  }

  static async getProvider(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const provider = await UserService.getProviderById(req.params.id as string);
      return ApiResponse.success(res, 200, 'Provider fetched successfully', { provider });
    } catch (error) {
      next(error);
    }
  }

  static async createProvider(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as CreateProviderBody;
      const provider = await UserService.createProvider(body);
      return ApiResponse.success(res, 201, 'Provider created successfully', { provider });
    } catch (error) {
      next(error);
    }
  }

  static async updateProvider(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as UpdateProviderBody;
      const provider = await UserService.updateProvider({ providerId: req.params.id as string, ...body });
      return ApiResponse.success(res, 200, 'Provider updated successfully', { provider });
    } catch (error) {
      next(error);
    }
  }

  static async updateSkills(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { skills } = req.body as UpdateSkillsBody;
      if (!Array.isArray(skills)) {
        return ApiResponse.error(res, 400, 'skills must be an array of device types');
      }

      const user = await UserService.updateSkills({ userId: req.user!.id, skills });
      return ApiResponse.success(res, 200, 'Skills updated successfully', { user });
    } catch (error) {
      next(error);
    }
  }

  static async updateProviderSkills(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { skills } = req.body as UpdateSkillsBody;
      if (!Array.isArray(skills)) {
        return ApiResponse.error(res, 400, 'skills must be an array of device types');
      }

      const user = await UserService.updateSkills({ userId: req.params.id as string, skills });
      return ApiResponse.success(res, 200, 'Provider skills updated successfully', { user });
    } catch (error) {
      next(error);
    }
  }

  // ─── Customer management (admin) ───────────────────────────────────────────

  static async listCustomers(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const search = req.query.search as string | undefined;
      const customers = await UserService.listCustomersWithStats(search);
      return ApiResponse.success(res, 200, 'Customers fetched successfully', { customers });
    } catch (error) {
      next(error);
    }
  }

  static async getCustomer(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const customer = await UserService.getCustomerById(req.params.id as string);
      return ApiResponse.success(res, 200, 'Customer fetched successfully', { customer });
    } catch (error) {
      next(error);
    }
  }

  static async updateCustomer(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as UpdateCustomerBody;
      const customer = await UserService.updateCustomer({ customerId: req.params.id as string, ...body });
      return ApiResponse.success(res, 200, 'Customer updated successfully', { customer });
    } catch (error) {
      next(error);
    }
  }

  static async createCustomerAddress(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as CreateAddressInput;
      if (!body.houseNo || !body.societyName) {
        return ApiResponse.error(res, 400, 'houseNo and societyName are required');
      }

      const address = await AddressService.create(req.params.id as string, body);
      return ApiResponse.success(res, 201, 'Address created successfully', { address });
    } catch (error) {
      next(error);
    }
  }

  static async updateCustomerAddress(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const body = req.body as UpdateAddressInput;
      const address = await AddressService.update(req.params.addressId as string, req.params.id as string, body);
      if (!address) return ApiResponse.error(res, 404, 'Address not found');

      return ApiResponse.success(res, 200, 'Address updated successfully', { address });
    } catch (error) {
      next(error);
    }
  }

  static async archiveCustomerAddress(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const address = await AddressService.delete(req.params.addressId as string, req.params.id as string);
      if (!address) return ApiResponse.error(res, 404, 'Address not found');

      return ApiResponse.success(res, 200, 'Address archived successfully', { address });
    } catch (error) {
      next(error);
    }
  }

  static async restoreCustomerAddress(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const address = await AddressService.restore(req.params.addressId as string, req.params.id as string);
      if (!address) return ApiResponse.error(res, 404, 'Address not found');

      return ApiResponse.success(res, 200, 'Address restored successfully', { address });
    } catch (error) {
      next(error);
    }
  }
}
