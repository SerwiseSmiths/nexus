import prisma from '@/services/prisma.service';
import { Role } from '@prisma/client';

let phoneCounter = 9000000000;
function nextPhone() {
  return String(phoneCounter++);
}

export async function createUser(role: Role = Role.CUSTOMER) {
  return prisma.user.create({ data: { phoneNo: nextPhone(), role } });
}

export async function createAddressFor(userId: string) {
  return prisma.address.create({
    data: { userId, houseNo: '12B', societyName: 'Green Meadows' },
  });
}

// A complaint (even with no device attached) is what establishes a
// provider-customer relationship in this app — see device.service.ts's
// assertProviderCanAccessCustomer.
export async function createComplaintLink(userId: string, providerId: string, addressId: string) {
  return prisma.complaint.create({
    data: { userId, providerId, addressId, title: 'AC not cooling' },
  });
}

export const VALID_METADATA: Record<string, Record<string, unknown>> = {
  master_purifier: {
    company: 'Kent',
    waterTankCapacity: 8,
    purchaseDate: '2025-01-21',
    basicTechnology: { spunFilter: true, uv: true },
    additionalTechnology: { copper: true },
  },
  air_conditioner: {
    company: 'Daikin',
    coolingType: 'SPLIT_UNIT',
    technology: 'INVERTER',
    gasType: 'R_32',
    distanceIndoorOutdoorFt: 15,
    purchaseDate: '2025-01-21',
    starRating: 5,
  },
  fridge: {
    company: 'Samsung',
    coolingType: 'FROST_FREE',
    capacityLtr: 350,
    numberOfDoors: 2,
    freezerPosition: 'TOP_FREEZER',
    gasType: 'R_600',
    purchaseDate: '2025-01-21',
  },
  washing_machine: {
    company: 'LG',
    loadType: 'FRONT_LOAD',
    automation: 'FULLY_AUTOMATIC',
    storageCapacityKg: 7,
    dryingCapability: 'HEAT_DRY',
    purchaseDate: '2025-01-21',
  },
  geyser: {
    company: 'Racold',
    heatingType: 'ELECTRIC',
    capacityLtr: 15,
    purchaseDate: '2025-01',
  },
};
