import { Router } from 'express';
import { Role } from '@prisma/client';
import { UserController } from '@/controllers/user.controller';
import { auth } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';

const router = Router();

/**
 * @swagger
 * /user/avatar:
 *   post:
 *     summary: Upload user avatar to Cloudinary
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [base64, mimeType]
 *             properties:
 *               base64:
 *                 type: string
 *                 description: Base64-encoded image data (without data URI prefix)
 *               mimeType:
 *                 type: string
 *                 example: image/jpeg
 *     responses:
 *       200:
 *         description: Avatar uploaded successfully
 */
router.post('/avatar', auth, UserController.uploadAvatar);

/**
 * @swagger
 * /user/profile:
 *   patch:
 *     summary: Update user profile
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, lastName]
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               avatarUrl:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *   get:
 *     summary: Get current user profile
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profile fetched successfully
 */
router.patch('/profile', auth, UserController.updateProfile);
router.get('/profile', auth, UserController.getProfile);

/**
 * @swagger
 * /user/email:
 *   patch:
 *     summary: Update user email
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Email updated successfully
 */
router.patch('/email', auth, UserController.updateEmail);

/**
 * @swagger
 * /user/providers:
 *   get:
 *     summary: List active providers (ADMIN)
 *     description: Used to populate a provider picker, e.g. when reassigning a complaint.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Filter by name or phone number
 *       - in: query
 *         name: deviceType
 *         schema:
 *           type: string
 *           enum: [MASTER_PURIFIER, AIR_CONDITIONER, FRIDGE, WASHING_MACHINE, GEYSER]
 *         description: Only return providers whose skills include this device type
 *       - in: query
 *         name: withStats
 *         schema: { type: boolean }
 *         description: Return full provider detail + stats (complaintSuccess, overdue, walletBalance) instead of the lightweight picker shape. Ignores isActive/deviceType filters.
 *     responses:
 *       200: { description: Providers fetched }
 *   post:
 *     summary: Create a provider account directly (ADMIN)
 *     description: Admin-created provider — active immediately, no OTP verification (unlike self-service signup).
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, lastName, phoneNo]
 *             properties:
 *               firstName: { type: string }
 *               lastName:  { type: string }
 *               phoneNo:   { type: string }
 *               email:     { type: string }
 *               skills:
 *                 type: array
 *                 items: { type: string, enum: [MASTER_PURIFIER, AIR_CONDITIONER, FRIDGE, WASHING_MACHINE, GEYSER] }
 *               currentAddress: { type: object }
 *               aadharAddress:  { type: object }
 *               adminNotes:     { type: string }
 *               imageBase64:    { type: string }
 *               imageMimeType:  { type: string }
 *     responses:
 *       201: { description: Provider created successfully }
 *       409: { description: Phone number or email already in use }
 */
router.get('/providers', auth, authorize([Role.ADMIN]), UserController.listProviders);
router.post('/providers', auth, authorize([Role.ADMIN]), UserController.createProvider);

/**
 * @swagger
 * /user/providers/{id}:
 *   get:
 *     summary: Get a single provider's full detail + stats (ADMIN)
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Provider fetched successfully }
 *       404: { description: Provider not found }
 *   patch:
 *     summary: Update a provider (ADMIN)
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Provider updated successfully }
 */
router.get('/providers/:id', auth, authorize([Role.ADMIN]), UserController.getProvider);
router.patch('/providers/:id', auth, authorize([Role.ADMIN]), UserController.updateProvider);

/**
 * @swagger
 * /user/providers/{id}/bank-account/approve:
 *   patch:
 *     summary: Approve a provider's payout bank account details (ADMIN)
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Bank account approved successfully }
 *       404: { description: Provider has no bank details to approve }
 */
router.patch('/providers/:id/bank-account/approve', auth, authorize([Role.ADMIN]), UserController.approveProviderBankAccount);

/**
 * @swagger
 * /user/{id}/skills:
 *   patch:
 *     summary: Set a provider's skills (ADMIN)
 *     description: Used by Watchtower to configure which device types a provider can be auto-assigned complaints for.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [skills]
 *             properties:
 *               skills:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [MASTER_PURIFIER, AIR_CONDITIONER, FRIDGE, WASHING_MACHINE, GEYSER]
 *     responses:
 *       200: { description: Provider skills updated successfully }
 */
router.patch('/:id/skills', auth, authorize([Role.ADMIN]), UserController.updateProviderSkills);

/**
 * @swagger
 * /user/customers:
 *   get:
 *     summary: List customers with stats (ADMIN)
 *     description: pinCode/location come from the first non-archived address added; walletBalance and connectedSince (createdAt) come from the user record.
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Filter by name, phone number, or pin code
 *     responses:
 *       200: { description: Customers fetched }
 *   post:
 *     summary: Create a customer account directly (ADMIN)
 *     description: Admin-created customer — active immediately, no OTP verification (unlike self-service signup).
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, lastName, phoneNo]
 *             properties:
 *               firstName: { type: string }
 *               lastName:  { type: string }
 *               phoneNo:   { type: string }
 *               email:     { type: string }
 *     responses:
 *       201: { description: Customer created successfully }
 *       409: { description: Phone number or email already in use }
 */
router.get('/customers', auth, authorize([Role.ADMIN]), UserController.listCustomers);
router.post('/customers', auth, authorize([Role.ADMIN]), UserController.createCustomer);

/**
 * @swagger
 * /user/customers/{id}:
 *   get:
 *     summary: Get a single customer's full detail, including archived addresses (ADMIN)
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Customer fetched successfully }
 *       404: { description: Customer not found }
 *   patch:
 *     summary: Update a customer's basic details (ADMIN)
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName: { type: string }
 *               lastName:  { type: string }
 *               phoneNo:   { type: string }
 *               email:     { type: string }
 *     responses:
 *       200: { description: Customer updated successfully }
 */
router.get('/customers/:id', auth, authorize([Role.ADMIN]), UserController.getCustomer);
router.patch('/customers/:id', auth, authorize([Role.ADMIN]), UserController.updateCustomer);

/**
 * @swagger
 * /user/customers/{id}/addresses:
 *   post:
 *     summary: Add an address for a customer (ADMIN)
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [houseNo, societyName]
 *             properties:
 *               title:          { type: string, example: Home }
 *               houseNo:        { type: string }
 *               societyName:    { type: string }
 *               addressLineOne: { type: string }
 *               addressLineTwo: { type: string }
 *               area:           { type: string }
 *               pinCode:        { type: string }
 *               city:           { type: string }
 *               state:          { type: string }
 *               country:        { type: string }
 *     responses:
 *       201: { description: Address created successfully }
 */
router.post('/customers/:id/addresses', auth, authorize([Role.ADMIN]), UserController.createCustomerAddress);

/**
 * @swagger
 * /user/customers/{id}/addresses/{addressId}:
 *   patch:
 *     summary: Update a customer's address (ADMIN)
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: addressId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Address updated successfully }
 *       404: { description: Address not found }
 */
router.patch('/customers/:id/addresses/:addressId', auth, authorize([Role.ADMIN]), UserController.updateCustomerAddress);

/**
 * @swagger
 * /user/customers/{id}/addresses/{addressId}/archive:
 *   patch:
 *     summary: Archive a customer's address — soft-delete (ADMIN)
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: addressId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Address archived successfully }
 *       404: { description: Address not found }
 */
router.patch('/customers/:id/addresses/:addressId/archive', auth, authorize([Role.ADMIN]), UserController.archiveCustomerAddress);

/**
 * @swagger
 * /user/customers/{id}/addresses/{addressId}/restore:
 *   patch:
 *     summary: Restore an archived customer address (ADMIN)
 *     tags: [User]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: addressId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Address restored successfully }
 *       404: { description: Address not found }
 */
router.patch('/customers/:id/addresses/:addressId/restore', auth, authorize([Role.ADMIN]), UserController.restoreCustomerAddress);

export default router;
