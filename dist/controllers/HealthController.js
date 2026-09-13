"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
const tslib_1 = require("tslib");
const apiResponse_1 = require("@/utils/apiResponse");
const prisma_service_1 = tslib_1.__importDefault(require("@/services/prisma.service"));
class HealthController {
    static ping = async (_req, res, next) => {
        try {
            await prisma_service_1.default.$queryRaw `SELECT 1`;
            return apiResponse_1.ApiResponse.success(res, 200, 'OK', {
                status: 'UP',
                db: 'connected',
                timestamp: new Date().toISOString(),
            });
        }
        catch (error) {
            next(error);
        }
    };
}
exports.HealthController = HealthController;
//# sourceMappingURL=HealthController.js.map