"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
require("dotenv/config");
const app_1 = tslib_1.__importDefault(require("./app"));
const configs_1 = require("@/configs");
const cloudinary_config_1 = require("@/configs/cloudinary.config");
const logger_1 = require("@/utils/logger");
const strapi_service_1 = require("@/services/strapi.service");
const assignmentDeadlineSweep_1 = require("@/jobs/assignmentDeadlineSweep");
const startServer = async () => {
    try {
        await (0, configs_1.initializeConfig)();
        (0, configs_1.startConfigPolling)();
        (0, assignmentDeadlineSweep_1.startAssignmentDeadlineSweep)();
        (0, cloudinary_config_1.initializeCloudinary)();
        const server = app_1.default.listen(configs_1.config.port, () => {
            logger_1.logger.info(`Nexus Backend started in ${configs_1.config.env} mode on port ${configs_1.config.port}`);
            strapi_service_1.StrapiService.ping();
        });
        process.on('SIGTERM', () => {
            logger_1.logger.info('SIGTERM signal received: closing HTTP server');
            server.close(() => {
                logger_1.logger.info('HTTP server closed');
            });
        });
    }
    catch (error) {
        logger_1.logger.error('Failed to start server:', error);
        process.exit(1);
    }
};
startServer();
//# sourceMappingURL=server.js.map