"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealthController = void 0;
class HealthController {
    static getStatus = (_req, res) => {
        res.status(200).json({
            status: 'UP',
            timestamp: new Date().toISOString(),
            service: 'Nexus Backend',
        });
    };
}
exports.HealthController = HealthController;
//# sourceMappingURL=HealthController.js.map