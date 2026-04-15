"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const HealthController_1 = require("@/controllers/HealthController");
const router = (0, express_1.Router)();
router.get('/', HealthController_1.HealthController.getStatus);
exports.default = router;
//# sourceMappingURL=healthRoutes.js.map