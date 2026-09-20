import { z } from 'zod';
import { DeviceType, type Role } from '@prisma/client';

// ---------------------------------------------------------------------------
// Device Keys
// Each key is a stable slug that maps to a Strapi content-type.
// Add new device keys here as new device types are onboarded.
// ---------------------------------------------------------------------------
export const DEVICE_KEYS = {
  MASTER_PURIFIER: 'master_purifier',
  AIR_CONDITIONER: 'air_conditioner',
  FRIDGE:          'fridge',
  WASHING_MACHINE: 'washing_machine',
  GEYSER:          'geyser',
} as const;

export type DeviceKey = (typeof DEVICE_KEYS)[keyof typeof DEVICE_KEYS];

// Shared between device.service.ts and complaint.service.ts (the latter
// resolves a requested deviceKey to its DeviceType, then to its
// DeviceTypeGroup, when creating/grouping complaints).
export const DEVICE_KEY_TO_TYPE: Record<DeviceKey, DeviceType> = {
  [DEVICE_KEYS.MASTER_PURIFIER]: DeviceType.MASTER_PURIFIER,
  [DEVICE_KEYS.AIR_CONDITIONER]: DeviceType.AIR_CONDITIONER,
  [DEVICE_KEYS.FRIDGE]:          DeviceType.FRIDGE,
  [DEVICE_KEYS.WASHING_MACHINE]: DeviceType.WASHING_MACHINE,
  [DEVICE_KEYS.GEYSER]:          DeviceType.GEYSER,
};

// Accepts a full ISO date ("YYYY-MM-DD") or a month-precision value ("YYYY-MM",
// from radix's month/year picker) and rejects anything that isn't actually a
// parseable date — previously an unparseable string was accepted here and
// silently defaulted to "now" at the point of use (device.service.ts), masking
// bad input from the client instead of rejecting it with a 400.
const purchaseDateSchema = z
  .string()
  .min(1, 'Purchase date is required')
  .refine((value) => {
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}(-\d{2})?$/.test(trimmed)) return false;
    const normalized = /^\d{4}-\d{2}$/.test(trimmed) ? `${trimmed}-01` : trimmed;
    return !isNaN(new Date(normalized).getTime());
  }, 'Purchase date must be a valid date (YYYY-MM-DD or YYYY-MM)');

// ---------------------------------------------------------------------------
// Master Purifier (RO) metadata schema
// ---------------------------------------------------------------------------
// Each field is a quantity (e.g. 2 spun filters) — radix's CheckboxGroup is a
// +/- counter per technology and sends numbers. watchtower's admin-facing
// AddApplianceForm still uses a plain checkbox and sends real booleans for
// the same fields — accepting both keeps that client working without forcing
// it into a counter UI it doesn't need; a boolean is just treated as 1/0.
// Technologies the client never touched are omitted from the payload
// entirely (not sent as `0`), so every key defaults to 0 when absent.
const technologyCount = () =>
  z
    .union([z.boolean(), z.number().int().min(0)])
    .optional()
    .transform((v) => (v === undefined ? 0 : typeof v === 'boolean' ? (v ? 1 : 0) : v));

const BasicTechnologySchema = z.object({
  spunFilter:       technologyCount(),
  sedimentFilter:   technologyCount(),
  preCarbonFilter:  technologyCount(),
  postCarbonFilter: technologyCount(),
  uv:               technologyCount(),
  uf:               technologyCount(),
  tdsController:    technologyCount(),
  alkalineFilter:   technologyCount(),
});

const AdditionalTechnologySchema = z.object({
  copper:    technologyCount(),
  magnesium: technologyCount(),
  zinc:      technologyCount(),
  selenium:  technologyCount(),
  other:     technologyCount(),
});

export const MasterPurifierMetaSchema = z.object({
  company:              z.string().min(1, 'Company is required'),
  waterTankCapacity:    z.number().positive('Water tank capacity must be positive'),
  purchaseDate:         purchaseDateSchema,
  basicTechnology:      BasicTechnologySchema,
  additionalTechnology: AdditionalTechnologySchema,
});

export type MasterPurifierMeta = z.infer<typeof MasterPurifierMetaSchema>;

// ---------------------------------------------------------------------------
// Air Conditioner metadata schema
// ---------------------------------------------------------------------------
export const AirConditionerMetaSchema = z.object({
  company:                        z.string().min(1, 'Company is required'),
  coolingType:                    z.enum(['SPLIT_UNIT', 'WINDOW_UNIT']),
  technology:                     z.enum(['INVERTER', 'FIXED_SPEED']),
  coolingCapacityTon:             z.number().min(0).optional(),
  coolingCapacityWatt:            z.number().min(0).optional(),
  gasType:                        z.enum(['R_22', 'R_32', 'R_410A']),
  distanceIndoorOutdoorFt:        z.number().min(0),
  purchaseDate:                   purchaseDateSchema,
  starRating:                     z.number().min(0).max(5).optional(),
  starRatingImageUrl:             z.string().url().optional(),
  notes:                          z.string().optional(),
});

export type AirConditionerMeta = z.infer<typeof AirConditionerMetaSchema>;

// ---------------------------------------------------------------------------
// Fridge metadata schema
// ---------------------------------------------------------------------------
export const FridgeMetaSchema = z.object({
  company:          z.string().min(1, 'Company is required'),
  coolingType:      z.enum(['DIRECT_COOLING', 'FROST_FREE']),
  capacityLtr:      z.number().min(0),
  numberOfDoors:    z.number().int().min(0),
  freezerPosition:  z.enum(['TOP_FREEZER', 'BOTTOM_FREEZER', 'SIDE_BY_SIDE']),
  gasType:          z.enum(['R_600', 'R_134A', 'R_290']),
  purchaseDate:     purchaseDateSchema,
  starRating:       z.number().min(0).max(5).optional(),
  starRatingImageUrl: z.string().url().optional(),
  notes:            z.string().optional(),
});

export type FridgeMeta = z.infer<typeof FridgeMetaSchema>;

// ---------------------------------------------------------------------------
// Washing Machine metadata schema
// ---------------------------------------------------------------------------
export const WashingMachineMetaSchema = z.object({
  company:            z.string().min(1, 'Company is required'),
  loadType:           z.enum(['FRONT_LOAD', 'TOP_LOAD']),
  automation:         z.enum(['SEMI_AUTOMATIC', 'FULLY_AUTOMATIC']),
  storageCapacityKg:  z.number().min(0),
  dryingCapability:   z.enum(['NONE', 'HEAT_DRY']),
  purchaseDate:       purchaseDateSchema,
  starRating:         z.number().min(0).max(5).optional(),
  starRatingImageUrl: z.string().url().optional(),
  notes:              z.string().optional(),
});

export type WashingMachineMeta = z.infer<typeof WashingMachineMetaSchema>;

// ---------------------------------------------------------------------------
// Geyser (Water Heater) metadata schema
// ---------------------------------------------------------------------------
export const GeyserMetaSchema = z.object({
  company:            z.string().min(1, 'Company is required'),
  heatingType:        z.enum(['GAS', 'ELECTRIC']),
  capacityLtr:        z.number().min(0),
  purchaseDate:       purchaseDateSchema,
  starRating:         z.number().min(0).max(5).optional(),
  starRatingImageUrl: z.string().url().optional(),
  notes:              z.string().optional(),
});

export type GeyserMeta = z.infer<typeof GeyserMetaSchema>;

// ---------------------------------------------------------------------------
// Validator registry — add new device schemas here as new types are added.
// The key must match a value in DEVICE_KEYS.
// ---------------------------------------------------------------------------
export const DEVICE_META_VALIDATORS = {
  [DEVICE_KEYS.MASTER_PURIFIER]: MasterPurifierMetaSchema,
  [DEVICE_KEYS.AIR_CONDITIONER]: AirConditionerMetaSchema,
  [DEVICE_KEYS.FRIDGE]:          FridgeMetaSchema,
  [DEVICE_KEYS.WASHING_MACHINE]: WashingMachineMetaSchema,
  [DEVICE_KEYS.GEYSER]:          GeyserMetaSchema,
} satisfies Record<DeviceKey, z.ZodSchema>;

// ---------------------------------------------------------------------------
// Request body types (what the controller receives from req.body)
// ---------------------------------------------------------------------------
export interface AddDeviceBody {
  deviceKey:  DeviceKey;
  addressId?: string;
  imageUrl?:  string;
  metadata:   Record<string, unknown>;
}

export interface UpdateDeviceBody {
  imageUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface AddWorkHistoryBody {
  event: string;
  eventDate: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Service input types (what the controller passes to the service)
// ---------------------------------------------------------------------------
export interface AddDeviceInput {
  userId:     string;
  addressId?: string;
  deviceKey:  DeviceKey;
  imageUrl?:  string;
  metadata:   Record<string, unknown>;
}

export interface UpdateDeviceInput {
  deviceId:  string;
  userId:    string;
  imageUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface AddWorkHistoryInput {
  deviceId:  string;
  userId:    string;
  event:     string;
  eventDate: string;
  notes?:    string;
}

// Provider-facing: add a device on behalf of a customer
export interface AddDeviceForCustomerBody {
  targetUserId: string;
  deviceKey:    DeviceKey;
  addressId?:   string;
  imageUrl?:    string;
  metadata:     Record<string, unknown>;
}

export interface AddDeviceForCustomerInput {
  targetUserId:  string;
  providerId:    string;
  requesterRole: Role;
  deviceKey:     DeviceKey;
  addressId?:    string;
  imageUrl?:     string;
  metadata:      Record<string, unknown>;
}

// Provider-facing: list a customer's devices
export interface ListCustomerDevicesInput {
  targetUserId:  string;
  requesterId:   string;
  requesterRole: Role;
  addressId?:    string;
  deviceKey?:    string;
}
