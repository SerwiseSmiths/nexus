"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const express_1 = require("express");
const healthRoutes_1 = tslib_1.__importDefault(require("./healthRoutes"));
const auth_route_1 = tslib_1.__importDefault(require("./auth.route"));
const me_route_1 = tslib_1.__importDefault(require("./me.route"));
const user_route_1 = tslib_1.__importDefault(require("./user.route"));
const address_route_1 = tslib_1.__importDefault(require("./address.route"));
const geocode_route_1 = tslib_1.__importDefault(require("./geocode.route"));
const device_route_1 = tslib_1.__importDefault(require("./device.route"));
const complaint_route_1 = tslib_1.__importDefault(require("./complaint.route"));
const notification_route_1 = tslib_1.__importDefault(require("./notification.route"));
const wallet_route_1 = tslib_1.__importDefault(require("./wallet.route"));
const parts_route_1 = tslib_1.__importDefault(require("./parts.route"));
const device_types_route_1 = tslib_1.__importDefault(require("./device-types.route"));
const provider_tier_route_1 = tslib_1.__importDefault(require("./provider-tier.route"));
const device_type_group_route_1 = tslib_1.__importDefault(require("./device-type-group.route"));
const service_part_pricing_route_1 = tslib_1.__importDefault(require("./service-part-pricing.route"));
const payment_route_1 = tslib_1.__importDefault(require("./payment.route"));
const subscription_route_1 = tslib_1.__importDefault(require("./subscription.route"));
const ota_route_1 = tslib_1.__importDefault(require("./ota.route"));
const cache_route_1 = tslib_1.__importDefault(require("./cache.route"));
const realtime_service_1 = require("@/services/realtime.service");
const supabase_config_1 = require("@/configs/supabase.config");
const router = (0, express_1.Router)();
router.use('/health', healthRoutes_1.default);
router.use('/auth', auth_route_1.default);
router.use('/me', me_route_1.default);
router.use('/user', user_route_1.default);
router.use('/address', address_route_1.default);
router.use('/geocode', geocode_route_1.default);
router.use('/device', device_route_1.default);
router.use('/complaint', complaint_route_1.default);
router.use('/notification', notification_route_1.default);
router.use('/wallet', wallet_route_1.default);
router.use('/parts', parts_route_1.default);
router.use('/device-types', device_types_route_1.default);
router.use('/provider-tiers', provider_tier_route_1.default);
router.use('/device-type-groups', device_type_group_route_1.default);
router.use('/service-part-pricing', service_part_pricing_route_1.default);
router.use('/payments', payment_route_1.default);
router.use('/subscription', subscription_route_1.default);
router.use('/ota', ota_route_1.default);
router.use('/cache', cache_route_1.default);
if (process.env.NODE_ENV !== 'production') {
    router.post('/debug/broadcast', async (req, res) => {
        const { userId, event = 'payment:verified', payload = { debug: true, amount: 100 } } = req.body ?? {};
        if (!userId)
            return res.status(400).json({ error: 'userId required' });
        const { url } = (0, supabase_config_1.getSupabaseConfig)();
        await realtime_service_1.RealtimeService.emitToUser(userId, event, payload);
        return res.json({ ok: true, supabaseUrl: url, channel: `user:${userId}`, event, payload });
    });
}
exports.default = router;
//# sourceMappingURL=index.js.map