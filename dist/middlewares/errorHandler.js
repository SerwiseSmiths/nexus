"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const logger_1 = require("@/utils/logger");
const apiResponse_1 = require("@/utils/apiResponse");
const errorHandler = (err, _req, res, _next) => {
    const statusCode = err instanceof apiResponse_1.ApiError ? err.statusCode : 500;
    const message = err.message || 'Internal Server Error';
    logger_1.logger.error(err);
    return apiResponse_1.ApiResponse.error(res, statusCode, message, err.data);
};
exports.errorHandler = errorHandler;
//# sourceMappingURL=errorHandler.js.map