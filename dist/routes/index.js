"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const express_1 = require("express");
const healthRoutes_1 = tslib_1.__importDefault(require("./healthRoutes"));
const router = (0, express_1.Router)();
router.use('/health', healthRoutes_1.default);
exports.default = router;
//# sourceMappingURL=index.js.map