import prisma from "./prisma.service";

export interface CreateAddressInput {
  title?: string;
  houseNo: string;
  societyName: string;
  addressLineOne?: string;
  addressLineTwo?: string;
  area?: string;
  pinCode?: string;
  city?: string;
  state?: string;
  country?: string;
  latitude?: string;
  longitude?: string;
  directionNote?: string;
}

export interface UpdateAddressInput extends Partial<CreateAddressInput> {}

export class AddressService {
  static async create(userId: string, data: CreateAddressInput) {
    return prisma.address.create({
      data: { userId, ...data },
    });
  }

  static async getAllByUser(userId: string) {
    return prisma.address.findMany({
      where: { userId, isDeleted: false },
      orderBy: { createdAt: "desc" },
    });
  }

  static async getById(id: string, userId: string) {
    return prisma.address.findFirst({
      where: { id, userId, isDeleted: false },
    });
  }

  static async update(id: string, userId: string, data: UpdateAddressInput) {
    const address = await prisma.address.findFirst({
      where: { id, userId, isDeleted: false },
    });

    if (!address) return null;

    return prisma.address.update({
      where: { id },
      data,
    });
  }

  static async delete(id: string, userId: string) {
    const address = await prisma.address.findFirst({
      where: { id, userId, isDeleted: false },
    });

    if (!address) return null;

    return prisma.address.update({
      where: { id },
      data: { isDeleted: true },
    });
  }

  static async restore(id: string, userId: string) {
    const address = await prisma.address.findFirst({
      where: { id, userId, isDeleted: true },
    });

    if (!address) return null;

    return prisma.address.update({
      where: { id },
      data: { isDeleted: false },
    });
  }

  /** Includes archived rows — admin needs to see and toggle them back, unlike the customer's own list. */
  static async getAllByUserIncludingArchived(userId: string) {
    return prisma.address.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
