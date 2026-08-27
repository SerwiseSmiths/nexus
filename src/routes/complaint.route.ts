import { Router } from 'express';
import { Role } from '@prisma/client';
import { ComplaintController } from '@/controllers/complaint.controller';
import { auth } from '@/middlewares/auth.middleware';
import { authorize } from '@/middlewares/authorize.middleware';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Complaint
 *   description: Service complaint lifecycle management
 */

// ─── Collection ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /complaint:
 *   post:
 *     summary: Create a new complaint (CUSTOMER)
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, addressId]
 *             properties:
 *               title:     { type: string, example: "RO not producing water" }
 *               notes:     { type: string }
 *               addressId: { type: string, format: uuid }
 *               deviceId:  { type: string, format: uuid }
 *               deviceKey: { type: string, example: master_purifier }
 *     responses:
 *       201: { description: Complaint created }
 *       400: { description: Validation error }
 */
router.post('/', auth, authorize([Role.CUSTOMER]), ComplaintController.createComplaint);

/**
 * @swagger
 * /complaint:
 *   get:
 *     summary: List all complaints (ADMIN)
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Complaints fetched }
 */
router.get('/', auth, authorize([Role.ADMIN]), ComplaintController.listComplaints);

/**
 * @swagger
 * /complaint/my:
 *   get:
 *     summary: Get the authenticated customer's complaints
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Complaints fetched }
 */
router.get('/my', auth, authorize([Role.CUSTOMER]), ComplaintController.myComplaints);

/**
 * @swagger
 * /complaint/assigned:
 *   get:
 *     summary: Get the authenticated provider's assigned complaints
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Complaints fetched }
 */
router.get('/assigned', auth, authorize([Role.PROVIDER]), ComplaintController.assignedComplaints);

// ─── Single Complaint ─────────────────────────────────────────────────────────

/**
 * @swagger
 * /complaint/{id}:
 *   get:
 *     summary: Get a single complaint with full details
 *     description: Customers see only their own. Providers see only assigned ones. Admins see all.
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Complaint fetched }
 *       403: { description: Forbidden }
 *       404: { description: Not found }
 */
router.get('/:id', auth, ComplaintController.getComplaint);

/**
 * @swagger
 * /complaint/{id}:
 *   delete:
 *     summary: Soft-delete a complaint (CUSTOMER/ADMIN)
 *     description: Customers can only delete ENTRANCE or REJECTED complaints. Admins can delete any.
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Deleted }
 *       403: { description: Forbidden }
 */
router.delete('/:id', auth, ComplaintController.deleteComplaint);

// ─── Stage ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /complaint/{id}/stage:
 *   patch:
 *     summary: Update complaint stage (PROVIDER/ADMIN)
 *     description: >
 *       Valid transitions —
 *       ENTRANCE → QR_VALIDATED | REJECTED,
 *       QR_VALIDATED → ESTIMATION | REJECTED,
 *       ESTIMATION → APPROVAL | REJECTED,
 *       APPROVAL → PAYMENT | ESTIMATION,
 *       PAYMENT → COMPLETED | REJECTED
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stage]
 *             properties:
 *               stage:
 *                 type: string
 *                 enum: [ENTRANCE, QR_VALIDATED, ESTIMATION, APPROVAL, PAYMENT, COMPLETED, REJECTED]
 *               rejectionReason:
 *                 type: string
 *     responses:
 *       200: { description: Stage updated }
 *       400: { description: Invalid transition }
 */
router.patch(
  '/:id/stage',
  auth,
  authorize([Role.PROVIDER, Role.ADMIN]),
  ComplaintController.updateStage,
);

// ─── Provider Assignment ──────────────────────────────────────────────────────

/**
 * @swagger
 * /complaint/{id}/assign:
 *   patch:
 *     summary: Assign a provider to a complaint (ADMIN)
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [providerId]
 *             properties:
 *               providerId: { type: string, format: uuid }
 *     responses:
 *       200: { description: Provider assigned }
 */
router.patch('/:id/assign', auth, authorize([Role.ADMIN]), ComplaintController.assignProvider);

/**
 * @swagger
 * /complaint/{id}/accept:
 *   patch:
 *     summary: Accept a complaint assignment (PROVIDER)
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Assignment accepted }
 */
router.patch('/:id/accept', auth, authorize([Role.PROVIDER]), ComplaintController.acceptAssignment);

/**
 * @swagger
 * /complaint/{id}/reject-assignment:
 *   patch:
 *     summary: Reject a complaint assignment (PROVIDER)
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Assignment rejected }
 */
router.patch(
  '/:id/reject-assignment',
  auth,
  authorize([Role.PROVIDER]),
  ComplaintController.rejectAssignment,
);

// ─── Quote ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /complaint/{id}/quote:
 *   post:
 *     summary: Submit or replace a quote (PROVIDER)
 *     description: Automatically moves the complaint to APPROVAL stage.
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     description: { type: string }
 *                     amount:      { type: number }
 *               notes: { type: string }
 *     responses:
 *       201: { description: Quote submitted }
 */
router.post('/:id/quote', auth, authorize([Role.PROVIDER]), ComplaintController.addQuote);

/**
 * @swagger
 * /complaint/{id}/quote/respond:
 *   patch:
 *     summary: Approve or reject a quote (CUSTOMER, or ADMIN acting on the customer's behalf)
 *     description: >
 *       Approve → moves to PAYMENT (or COMPLETED if totalAmount = 0).
 *       Reject → moves to REJECTED and closes the complaint.
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [approved]
 *             properties:
 *               approved:        { type: boolean }
 *               rejectionReason: { type: string }
 *     responses:
 *       200: { description: Response recorded }
 */
router.patch(
  '/:id/quote/respond',
  auth,
  authorize([Role.CUSTOMER, Role.ADMIN]),
  ComplaintController.respondToQuote,
);

// ─── Device ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /complaint/{id}/device:
 *   patch:
 *     summary: Link a device to a complaint (CUSTOMER or PROVIDER)
 *     description: >
 *       Customer can link a device they own. Provider can link a device that belongs
 *       to the complaint's customer when the complaint is in QR_VALIDATED stage;
 *       linking auto-advances the complaint to ESTIMATION.
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [deviceId]
 *             properties:
 *               deviceId:  { type: string, format: uuid }
 *               deviceKey: { type: string, example: master_purifier }
 *     responses:
 *       200: { description: Device linked }
 *       403: { description: Forbidden }
 */
router.patch(
  '/:id/device',
  auth,
  authorize([Role.CUSTOMER, Role.PROVIDER, Role.ADMIN]),
  ComplaintController.linkDevice,
);

/**
 * @swagger
 * /complaint/{id}/complete-payment:
 *   patch:
 *     summary: Mark payment as collected and close the complaint (PROVIDER)
 *     description: >
 *       Moves complaint from PAYMENT → COMPLETED, credits provider wallet,
 *       and fires FCM notifications to both customer and provider.
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [method]
 *             properties:
 *               method:
 *                 type: string
 *                 enum: [CASH, WALLET]
 *     responses:
 *       200: { description: Payment completed, complaint closed }
 *       400: { description: Complaint not in PAYMENT stage }
 *       403: { description: Not the assigned provider }
 */
router.patch(
  '/:id/complete-payment',
  auth,
  authorize([Role.PROVIDER]),
  ComplaintController.completePayment,
);

// ─── QR Entry ─────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /complaint/{id}/qr/generate:
 *   post:
 *     summary: Generate an entry QR token for the complaint (CUSTOMER)
 *     description: Token is valid for 10 minutes. Customer displays this QR for the provider to scan.
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: QR token generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     token:     { type: string }
 *                     expiresAt: { type: string, format: date-time }
 */
router.post(
  '/:id/qr/generate',
  auth,
  authorize([Role.CUSTOMER]),
  ComplaintController.generateEntryQr,
);

/**
 * @swagger
 * /complaint/{id}/qr/validate:
 *   post:
 *     summary: Validate the customer's QR token (PROVIDER)
 *     description: On success moves stage from ENTRANCE to QR_VALIDATED.
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200: { description: QR validated — stage moved to QR_VALIDATED }
 *       400: { description: Invalid or expired token }
 */
router.post(
  '/:id/qr/validate',
  auth,
  authorize([Role.PROVIDER]),
  ComplaintController.validateEntryQr,
);

/**
 * @swagger
 * /complaint/{id}/qr/request-scan:
 *   post:
 *     summary: Ask the customer to display their QR code (PROVIDER)
 *     description: >
 *       Sends a Supabase Realtime event and FCM push to the customer.
 *       Generates/refreshes the QR token if missing or expired.
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Scan request sent to customer }
 */
router.post(
  '/:id/qr/request-scan',
  auth,
  authorize([Role.PROVIDER]),
  ComplaintController.requestEntranceScan,
);

// ─── Reopen ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /complaint/{id}/reopen:
 *   post:
 *     summary: Reopen a completed or rejected complaint as a new one (CUSTOMER)
 *     description: Creates a new complaint with parentId pointing to the original.
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:     { type: string }
 *               notes:     { type: string }
 *               addressId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Complaint reopened }
 *       400: { description: Complaint is not closed }
 */
router.post(
  '/:id/reopen',
  auth,
  authorize([Role.CUSTOMER]),
  ComplaintController.reopenComplaint,
);

// ─── Dev (non-production only) ────────────────────────────────────────────────

/**
 * @swagger
 * /complaint/{id}/dev/advance:
 *   patch:
 *     summary: DEV ONLY — force-advance complaint to the next stage
 *     description: >
 *       Auto-assigns a provider, accepts the assignment, skips QR scan,
 *       injects a mock quote, and advances stage in sequence.
 *       Blocked in production.
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Stage advanced }
 *       400: { description: Cannot advance (already completed/rejected) }
 *       403: { description: Not available in production }
 */
if (process.env.NODE_ENV !== 'production') {
  router.patch('/:id/dev/advance', auth, ComplaintController.devAdvanceStage);
}

export default router;
