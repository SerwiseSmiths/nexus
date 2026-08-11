import { Router } from 'express';
import { Role } from '@prisma/client';
import { DeviceController } from '@/controllers/device.controller';
import { auth } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';

const router = Router();

// ---------------------------------------------------------------------------
// Device CRUD
// ---------------------------------------------------------------------------

/**
 * @swagger
 * tags:
 *   name: Device
 *   description: Device management — add, update, list, and delete user devices
 */

/**
 * @swagger
 * /device:
 *   post:
 *     summary: Add a new device
 *     description: >
 *       Registers a new device for the authenticated user. The `deviceKey` slug
 *       (e.g. `master_purifier`) determines which metadata schema is applied for
 *       validation and maps to the corresponding Strapi content-type.
 *     tags: [Device]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [deviceKey, metadata]
 *             properties:
 *               deviceKey:
 *                 type: string
 *                 enum: [master_purifier, air_conditioner, fridge, washing_machine]
 *                 example: washing_machine
 *               imageUrl:
 *                 type: string
 *                 example: https://res.cloudinary.com/example/image.jpg
 *               metadata:
 *                 type: object
 *                 description: Fields vary by deviceKey. See schema below for master_purifier.
 *                 example:
 *                   company: "Kent"
 *                   waterTankCapacity: 8
 *                   purchaseDate: "2025-01-21"
 *                   basicTechnology:
 *                     spunFilter: true
 *                     sedimentFilter: true
 *                     preCarbonFilter: true
 *                     postCarbonFilter: false
 *                     uv: true
 *                     uf: false
 *                     tdsController: true
 *                     alkalineFilter: false
 *                   additionalTechnology:
 *                     copper: false
 *                     magnesium: true
 *                     zinc: false
 *                     selenium: false
 *                     other: false
 *     responses:
 *       201:
 *         description: Device added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: Device added successfully }
 *                 data:
 *                   type: object
 *                   properties:
 *                     device: { $ref: '#/components/schemas/Device' }
 *       400:
 *         description: Missing fields or invalid metadata
 *       401:
 *         description: Unauthorized
 */
router.post('/', auth, DeviceController.addDevice);

/**
 * @swagger
 * /device/for-customer:
 *   post:
 *     summary: Add a device on behalf of a customer (PROVIDER)
 *     description: >
 *       Provider creates a device record owned by the customer (`targetUserId`).
 *       Metadata is validated against the device-type schema, same as self-registration.
 *     tags: [Device]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [targetUserId, deviceKey, metadata]
 *             properties:
 *               targetUserId: { type: string, format: uuid }
 *               deviceKey:    { type: string, example: air_conditioner }
 *               addressId:    { type: string, format: uuid }
 *               imageUrl:     { type: string }
 *               metadata:     { type: object }
 *     responses:
 *       201: { description: Device added for customer }
 *       400: { description: Validation error }
 */
router.post('/for-customer', auth, authorize([Role.PROVIDER]), DeviceController.addForCustomer);

/**
 * @swagger
 * /device/customer/{userId}:
 *   get:
 *     summary: List devices belonging to a specific customer (PROVIDER)
 *     description: Provider retrieves all devices owned by the given customer, optionally filtered by address.
 *     tags: [Device]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: addressId
 *         schema: { type: string, format: uuid }
 *         description: Filter devices by address
 *       - in: query
 *         name: deviceKey
 *         schema: { type: string }
 *         description: Filter devices by device type (e.g. the complaint's deviceKey)
 *     responses:
 *       200: { description: Devices fetched }
 */
router.get('/customer/:userId', auth, authorize([Role.PROVIDER]), DeviceController.listForCustomer);

/**
 * @swagger
 * /device:
 *   get:
 *     summary: List all devices for the authenticated user
 *     tags: [Device]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: deviceKey
 *         schema:
 *           type: string
 *           enum: [master_purifier, air_conditioner, fridge, washing_machine]
 *         description: Filter by device type slug
 *     responses:
 *       200:
 *         description: Devices fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     devices:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/Device' }
 *       401:
 *         description: Unauthorized
 */
router.get('/', auth, DeviceController.getDevices);

/**
 * @swagger
 * /device/{id}:
 *   get:
 *     summary: Get a single device with its full work history
 *     tags: [Device]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Device fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     device: { $ref: '#/components/schemas/DeviceWithHistory' }
 *       404:
 *         description: Device not found
 *       401:
 *         description: Unauthorized
 */
router.get('/:id', auth, DeviceController.getDevice);

/**
 * @swagger
 * /device/{id}:
 *   patch:
 *     summary: Update a device's image or metadata
 *     tags: [Device]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               imageUrl:
 *                 type: string
 *               metadata:
 *                 type: object
 *                 description: Full metadata object — must match the device's original schema
 *     responses:
 *       200:
 *         description: Device updated successfully
 *       400:
 *         description: Invalid metadata
 *       404:
 *         description: Device not found
 *       401:
 *         description: Unauthorized
 */
router.patch('/:id', auth, DeviceController.updateDevice);

/**
 * @swagger
 * /device/{id}:
 *   delete:
 *     summary: Soft-delete a device
 *     tags: [Device]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Device deleted successfully
 *       404:
 *         description: Device not found
 *       401:
 *         description: Unauthorized
 */
router.delete('/:id', auth, DeviceController.deleteDevice);

// ---------------------------------------------------------------------------
// Work History
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /device/{id}/work-history:
 *   post:
 *     summary: Add a work history event to a device
 *     description: >
 *       Records a lifecycle event for the device (e.g. filter change, pump service).
 *       Valid events: PURCHASED, INSTALLED, REPAIR, INSPECTION, UNINSTALLED, FILTER_CHANGE.
 *       Note: PURCHASED and INSTALLED are also auto-recorded when a device is added,
 *       and REPAIR/FILTER_CHANGE are auto-recorded when a complaint's service completes —
 *       use this endpoint for manual corrections or events outside that flow (e.g. INSPECTION).
 *     tags: [Device]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Device ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [event, eventDate]
 *             properties:
 *               event:
 *                 type: string
 *                 enum:
 *                   - PURCHASED
 *                   - INSTALLED
 *                   - REPAIR
 *                   - INSPECTION
 *                   - UNINSTALLED
 *                   - FILTER_CHANGE
 *                 example: REPAIR
 *               eventDate:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-01-21T00:00:00.000Z"
 *               notes:
 *                 type: string
 *                 example: "Replaced all basic filters during annual service"
 *     responses:
 *       201:
 *         description: Work history entry added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     entry: { $ref: '#/components/schemas/WorkHistoryEntry' }
 *       400:
 *         description: Missing fields or invalid event type
 *       404:
 *         description: Device not found
 *       401:
 *         description: Unauthorized
 */
router.post('/:id/work-history', auth, DeviceController.addWorkHistory);

/**
 * @swagger
 * /device/{id}/work-history:
 *   get:
 *     summary: Get all work history for a device
 *     tags: [Device]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Device ID
 *     responses:
 *       200:
 *         description: Work history fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     history:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/WorkHistoryEntry' }
 *       404:
 *         description: Device not found
 *       401:
 *         description: Unauthorized
 */
router.get('/:id/work-history', auth, DeviceController.getWorkHistory);

/**
 * @swagger
 * /device/{id}/work-history/{entryId}:
 *   delete:
 *     summary: Soft-delete a work history entry
 *     tags: [Device]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Device ID
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: string, format: uuid }
 *         description: Work history entry ID
 *     responses:
 *       200:
 *         description: Work history entry deleted successfully
 *       404:
 *         description: Device or entry not found
 *       401:
 *         description: Unauthorized
 */
router.delete('/:id/work-history/:entryId', auth, DeviceController.deleteWorkHistoryEntry);

// ---------------------------------------------------------------------------
// Swagger component schemas (referenced above with $ref)
// ---------------------------------------------------------------------------

/**
 * @swagger
 * components:
 *   schemas:
 *     Device:
 *       type: object
 *       properties:
 *         id:           { type: string, format: uuid }
 *         userId:       { type: string, format: uuid }
 *         deviceKey:    { type: string, example: air_conditioner }
 *         type:         { type: string, enum: [MASTER_PURIFIER, AIR_CONDITIONER, FRIDGE, WASHING_MACHINE] }
 *         imageUrl:     { type: string, nullable: true }
 *         metadata:     { type: object, description: Type-specific fields }
 *         isDeleted:    { type: boolean }
 *         createdAt:    { type: string, format: date-time }
 *         updatedAt:    { type: string, format: date-time }
 *
 *     DeviceWithHistory:
 *       allOf:
 *         - $ref: '#/components/schemas/Device'
 *         - type: object
 *           properties:
 *             workHistory:
 *               type: array
 *               items: { $ref: '#/components/schemas/WorkHistoryEntry' }
 *
 *     WorkHistoryEntry:
 *       type: object
 *       properties:
 *         id:        { type: string, format: uuid }
 *         deviceId:  { type: string, format: uuid }
 *         event:
 *           type: string
 *           enum:
 *             - PURCHASED
 *             - INSTALLED
 *             - REPAIR
 *             - INSPECTION
 *             - UNINSTALLED
 *             - FILTER_CHANGE
 *         eventDate: { type: string, format: date-time }
 *         notes:     { type: string, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *
 *     MasterPurifierMetadata:
 *       type: object
 *       required: [company, waterTankCapacity, purchaseDate, basicTechnology, additionalTechnology]
 *       properties:
 *         company:
 *           type: string
 *           example: Kent
 *         waterTankCapacity:
 *           type: number
 *           example: 8
 *         purchaseDate:
 *           type: string
 *           example: "2025-01-21"
 *         basicTechnology:
 *           type: object
 *           properties:
 *             spunFilter:       { type: boolean }
 *             sedimentFilter:   { type: boolean }
 *             preCarbonFilter:  { type: boolean }
 *             postCarbonFilter: { type: boolean }
 *             uv:               { type: boolean }
 *             uf:               { type: boolean }
 *             tdsController:    { type: boolean }
 *             alkalineFilter:   { type: boolean }
 *         additionalTechnology:
 *           type: object
 *           properties:
 *             copper:    { type: boolean }
 *             magnesium: { type: boolean }
 *             zinc:      { type: boolean }
 *             selenium:  { type: boolean }
 *             other:     { type: boolean }
 *
 *     AirConditionerMetadata:
 *       type: object
 *       required: [company, coolingType, technology, gasType, distanceIndoorOutdoorFt, purchaseDate]
 *       properties:
 *         company:
 *           type: string
 *           example: Daikin
 *         coolingType:
 *           type: string
 *           enum: [SPLIT_UNIT, WINDOW_UNIT]
 *           example: SPLIT_UNIT
 *         technology:
 *           type: string
 *           enum: [INVERTER, FIXED_SPEED]
 *           example: INVERTER
 *         coolingCapacityTon:
 *           type: number
 *           example: 1.5
 *         coolingCapacityWatt:
 *           type: number
 *           example: 0
 *         gasType:
 *           type: string
 *           enum: [R_22, R_32, R_410A]
 *           example: R_32
 *         distanceIndoorOutdoorFt:
 *           type: number
 *           example: 15
 *         purchaseDate:
 *           type: string
 *           example: "2025-01-21"
 *         starRating:
 *           type: number
 *           minimum: 0
 *           maximum: 5
 *           example: 5
 *         starRatingImageUrl:
 *           type: string
 *           example: "https://res.cloudinary.com/example/star-rating.jpg"
 *         notes:
 *           type: string
 *           example: "Installed in master bedroom"
 *
 *     FridgeMetadata:
 *       type: object
 *       required: [company, coolingType, capacityLtr, numberOfDoors, freezerPosition, gasType, purchaseDate]
 *       properties:
 *         company:
 *           type: string
 *           example: Samsung
 *         coolingType:
 *           type: string
 *           enum: [DIRECT_COOLING, FROST_FREE]
 *           example: FROST_FREE
 *         capacityLtr:
 *           type: number
 *           example: 350
 *         numberOfDoors:
 *           type: integer
 *           example: 2
 *         freezerPosition:
 *           type: string
 *           enum: [TOP_FREEZER, BOTTOM_FREEZER, SIDE_BY_SIDE]
 *           example: TOP_FREEZER
 *         gasType:
 *           type: string
 *           enum: [R_600, R_134A, R_290]
 *           example: R_600
 *         purchaseDate:
 *           type: string
 *           example: "2025-01-21"
 *         starRating:
 *           type: number
 *           minimum: 0
 *           maximum: 5
 *           example: 4
 *         starRatingImageUrl:
 *           type: string
 *           example: "https://res.cloudinary.com/example/star-rating.jpg"
 *         notes:
 *           type: string
 *           example: "Double door frost free fridge"
 *
 *     WashingMachineMetadata:
 *       type: object
 *       required: [company, loadType, automation, storageCapacityKg, dryingCapability, purchaseDate]
 *       properties:
 *         company:
 *           type: string
 *           example: LG
 *         loadType:
 *           type: string
 *           enum: [FRONT_LOAD, TOP_LOAD]
 *           example: FRONT_LOAD
 *         automation:
 *           type: string
 *           enum: [SEMI_AUTOMATIC, FULLY_AUTOMATIC]
 *           example: FULLY_AUTOMATIC
 *         storageCapacityKg:
 *           type: number
 *           example: 7
 *         dryingCapability:
 *           type: string
 *           enum: [NONE, HEAT_DRY]
 *           example: HEAT_DRY
 *         purchaseDate:
 *           type: string
 *           example: "2025-01-21"
 *         starRating:
 *           type: number
 *           minimum: 0
 *           maximum: 5
 *           example: 5
 *         starRatingImageUrl:
 *           type: string
 *           example: "https://res.cloudinary.com/example/star-rating.jpg"
 *         notes:
 *           type: string
 *           example: "7kg fully automatic front load"
 */

export default router;
