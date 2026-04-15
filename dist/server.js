"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
require("module-alias/register");
const app_1 = tslib_1.__importDefault(require("./app"));
const configs_1 = require("@/configs");
const logger_1 = require("@/utils/logger");
const server = app_1.default.listen(configs_1.config.port, () => {
    logger_1.logger.info(`Nexus Backend started in ${configs_1.config.env} mode on port ${configs_1.config.port}`);
});
process.on('SIGTERM', () => {
    logger_1.logger.info('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        logger_1.logger.info('HTTP server closed');
    });
});
//# sourceMappingURL=server.js.map