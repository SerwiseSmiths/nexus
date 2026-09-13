import { Router } from 'express';
import { Role } from '@prisma/client';
import { DeviceTypeGroupController } from '@/controllers/device-type-group.controller';
import { auth } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: DeviceTypeGroup
 *   description: >
 *     Admin-managed groups of device types that must be serviced by a single
 *     provider (e.g. "Air Conditioner + Fridge"). Every DeviceType belongs to
 *     exactly one active group — standalone types just get their own
 *     1-member group. Drives complaint splitting (one ticket per group) and
 *     provider skill matching (a provider's skill is a group, not a raw
 *     device type).
 */

/**
 * @swagger
 * /device-type-groups:
 *   get:
 *     summary: List device type groups (ADMIN)
 *     tags: [DeviceTypeGroup]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Device type groups fetched }
 *   post:
 *     summary: Create a device type group (ADMIN)
 *     description: Fails with 409 if any requested device type already belongs to another group.
 *     tags: [DeviceTypeGroup]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, deviceTypes]
 *             properties:
 *               name:        { type: string, example: "Air Conditioner + Fridge" }
 *               deviceTypes: { type: array, items: { type: string }, example: ["AIR_CONDITIONER", "FRIDGE"] }
 *     responses:
 *       201: { description: Device type group created successfully }
 *       409: { description: One or more device types already belong to another group }
 */
router.get('/', auth, authorize([Role.ADMIN]), DeviceTypeGroupController.getAll);
router.post('/', auth, authorize([Role.ADMIN]), DeviceTypeGroupController.create);

/**
 * @swagger
 * /device-type-groups/{key}:
 *   get:
 *     summary: Get a device type group by its stable key (ADMIN)
 *     description: >
 *       `key` is the slug auto-generated from `name` at creation time (e.g.
 *       "Air Conditioner + Fridge" -> "air_conditioner_fridge") — immutable
 *       thereafter, even if the group is renamed. Every external consumer
 *       (watchtower, radix, serwise) references a group by this key, not its
 *       internal database id.
 *     tags: [DeviceTypeGroup]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Device type group fetched successfully }
 *       404: { description: Device type group not found }
 *   patch:
 *     summary: Update a device type group (ADMIN)
 *     description: The group's `key` never changes, even if `name` is updated here.
 *     tags: [DeviceTypeGroup]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Device type group updated successfully }
 *       409: { description: One or more device types already belong to another group }
 *   delete:
 *     summary: Delete a device type group (ADMIN)
 *     description: >
 *       Rejected with 409 if the group still has device types assigned (reassign
 *       them first) or if any provider currently has it as a skill.
 *     tags: [DeviceTypeGroup]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Device type group deleted successfully }
 *       409: { description: Group still has device types or in-use providers }
 */
router.get('/:key', auth, authorize([Role.ADMIN]), DeviceTypeGroupController.getById);
router.patch('/:key', auth, authorize([Role.ADMIN]), DeviceTypeGroupController.update);
router.delete('/:key', auth, authorize([Role.ADMIN]), DeviceTypeGroupController.remove);

export default router;
