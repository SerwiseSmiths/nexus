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
 *     summary: Create a new complaint (CUSTOMER, or ADMIN on a customer's behalf)
 *     description: When called by ADMIN, customerId is required and identifies whose ticket this is.
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, addressId, requestedDevices]
 *             properties:
 *               title:      { type: string, example: "RO not producing water" }
 *               notes:      { type: string }
 *               addressId:  { type: string, format: uuid }
 *               requestedDevices:
 *                 type: array
 *                 description: >
 *                   Device type + quantity requested. Devices need not pre-exist —
 *                   physical units are identified later on-site (see /link-device).
 *                   Requested devices spanning multiple device-type groups are
 *                   split into one complaint per group.
 *                 items:
 *                   type: object
 *                   required: [deviceKey]
 *                   properties:
 *                     deviceKey: { type: string, example: master_purifier }
 *                     quantity:  { type: integer, example: 1, default: 1 }
 *               customerId: { type: string, format: uuid, description: "Required when called by ADMIN" }
 *     responses:
 *       201: { description: Complaint (or complaints, if requestedDevices spans multiple device groups) created }
 *       400: { description: Validation error }
 */
router.post('/', auth, authorize([Role.CUSTOMER, Role.ADMIN]), ComplaintController.createComplaint);

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

/**
 * @swagger
 * /complaint/assignment/pending:
 *   get:
 *     summary: Claim every deferred job-assignment popup (PROVIDER)
 *     description: >
 *       The full-screen "New Job" popup only fires live between 9am-6pm IST.
 *       An assignment made outside that window is held server-side; call
 *       this whenever the app opens (cold start or resume) to pick up and
 *       clear all of them (there can be more than one), so every one can be
 *       shown immediately, queued oldest-first. If the provider never calls
 *       this before an assignment's deadline, it's reassigned to a different
 *       provider.
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending assignments checked — `complaints` is an empty array if there's nothing to deliver
 */
router.get(
  '/assignment/pending',
  auth,
  authorize([Role.PROVIDER]),
  ComplaintController.pendingAssignment,
);

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
 *       APPROVAL → IN_PROGRESS | REJECTED,
 *       IN_PROGRESS → PAYMENT | REJECTED,
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
 *                 enum: [ENTRANCE, QR_VALIDATED, ESTIMATION, APPROVAL, IN_PROGRESS, PAYMENT, COMPLETED, REJECTED]
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

/**
 * @swagger
 * /complaint/{id}/assignment-action-token:
 *   get:
 *     summary: Issue a short-lived accept/reject token for a pending assignment (PROVIDER)
 *     description: >
 *       Used by radix before handing a socket-delivered job offer to its native
 *       floating popup, which has no session of its own. The FCM push path
 *       already carries this token in its data payload.
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Token issued }
 */
router.get(
  '/:id/assignment-action-token',
  auth,
  authorize([Role.PROVIDER]),
  ComplaintController.getAssignmentActionToken,
);

/**
 * @swagger
 * /complaint/{id}/assignment-action:
 *   post:
 *     summary: Accept or reject an assignment with an action token (no session)
 *     description: >
 *       Called by radix's native floating job popup from the phone's home
 *       screen. Authenticated by the signed, 15-minute action token instead of
 *       a bearer token, and only valid while the job is still awaiting that
 *       provider's decision.
 *     tags: [Complaint]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, action]
 *             properties:
 *               token:  { type: string }
 *               action: { type: string, enum: [accept, reject] }
 *     responses:
 *       200: { description: Assignment accepted / rejected }
 *       401: { description: Token invalid or expired }
 *       409: { description: No longer assigned, or already accepted }
 */
router.post('/:id/assignment-action', ComplaintController.respondToAssignmentWithToken);

// ─── Quote ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /complaint/{id}/quote:
 *   post:
 *     summary: Submit or replace a quote (PROVIDER, or ADMIN on the assigned provider's behalf)
 *     description: >
 *       Automatically moves the complaint to APPROVAL stage. An ADMIN can enter a
 *       quote from watchtower (e.g. a phoned-in estimate) — the complaint must
 *       already have a provider assigned.
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
 *                   required: [name, unitPrice]
 *                   properties:
 *                     name:      { type: string }
 *                     unitPrice: { type: number }
 *                     quantity:  { type: integer, default: 1 }
 *                     partId:    { type: string, description: "Strapi service-part documentId — when set, name/unitPrice are re-resolved from the CMS unless priceOverridden is true" }
 *                     priceOverridden: { type: boolean, description: "Only meaningful with partId set — trusts this item's unitPrice verbatim instead of re-resolving it from the CMS (e.g. the real cost ran higher than the listed price)" }
 *               notes: { type: string }
 *     responses:
 *       201: { description: Quote submitted }
 *       400: { description: Not yet eligible for a quote, or no provider assigned (ADMIN) }
 *       404: { description: Complaint not found or not assigned to you }
 */
router.post('/:id/quote', auth, authorize([Role.PROVIDER, Role.ADMIN]), ComplaintController.addQuote);

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
 *       Identifies the physical device unit(s) for the complaint's requested devices,
 *       on-site. Customer can link a device they own. Provider can link a device that
 *       belongs to the complaint's customer when the complaint is in QR_VALIDATED
 *       stage; linking auto-advances the complaint to ESTIMATION.
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
 *             required: [devices]
 *             properties:
 *               devices:
 *                 type: array
 *                 description: >
 *                   Each item is either an existing device (deviceId) or a brand-new
 *                   one to create (deviceKey + metadata), but never both.
 *                 items:
 *                   type: object
 *                   properties:
 *                     deviceId:  { type: string, format: uuid, description: "Existing device owned by the customer" }
 *                     deviceKey: { type: string, example: master_purifier, description: "New device to create" }
 *                     metadata:  { type: object, description: "Required when creating a new device via deviceKey" }
 *                     imageUrl:  { type: string }
 *     responses:
 *       200: { description: Devices linked }
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
 * /complaint/{id}/complete-service:
 *   patch:
 *     summary: Mark the repair itself as finished (PROVIDER)
 *     description: >
 *       Moves complaint from IN_PROGRESS → PAYMENT. Call this once the physical
 *       repair is done and the customer needs to pay to close the request.
 *     tags: [Complaint]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Repair marked complete, complaint moved to PAYMENT }
 *       400: { description: Complaint not in IN_PROGRESS stage }
 *       404: { description: Complaint not found or not assigned to you }
 */
router.patch(
  '/:id/complete-service',
  auth,
  authorize([Role.PROVIDER]),
  ComplaintController.completeService,
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
 *     summary: Reopen a completed or rejected complaint as a new one (CUSTOMER, or ADMIN on the customer's behalf)
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
  authorize([Role.CUSTOMER, Role.ADMIN]),
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
