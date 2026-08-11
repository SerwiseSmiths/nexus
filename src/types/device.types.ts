import { z } from 'zod';

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

// ---------------------------------------------------------------------------
// Master Purifier (RO) metadata schema
// ---------------------------------------------------------------------------
// Checkboxes the client never toggled are omitted from the payload entirely
// (not sent as `false`), so every key defaults to false when absent.
const BasicTechnologySchema = z.object({
  spunFilter:       z.boolean().optional().default(false),
  sedimentFilter:   z.boolean().optional().default(false),
  preCarbonFilter:  z.boolean().optional().default(false),
  postCarbonFilter: z.boolean().optional().default(false),
  uv:               z.boolean().optional().default(false),
  uf:               z.boolean().optional().default(false),
  tdsController:    z.boolean().optional().default(false),
  alkalineFilter:   z.boolean().optional().default(false),
});

const AdditionalTechnologySchema = z.object({
  copper:    z.boolean().optional().default(false),
  magnesium: z.boolean().optional().default(false),
  zinc:      z.boolean().optional().default(false),
  selenium:  z.boolean().optional().default(false),
  other:     z.boolean().optional().default(false),
});

export const MasterPurifierMetaSchema = z.object({
  company:              z.string().min(1, 'Company is required'),
  waterTankCapacity:    z.number().positive('Water tank capacity must be positive'),
  purchaseDate:         z.string().min(1, 'Purchase date is required'),
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
  purchaseDate:                   z.string().min(1, 'Purchase date is required'),
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
  purchaseDate:     z.string().min(1, 'Purchase date is required'),
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
  purchaseDate:       z.string().min(1, 'Purchase date is required'),
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
  purchaseDate:       z.string().min(1, 'Purchase date is required'),
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
  targetUserId: string;
  providerId:   string;
  deviceKey:    DeviceKey;
  addressId?:   string;
  imageUrl?:    string;
  metadata:     Record<string, unknown>;
}

// Provider-facing: list a customer's devices
export interface ListCustomerDevicesInput {
  targetUserId: string;
  addressId?:   string;
  deviceKey?:   string;
}
