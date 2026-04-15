"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.AppError = void 0;
const logger_1 = require("@/utils/logger");
class AppError extends Error {
    statusCode;
    message;
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.message = message;
        Object.setPrototypeOf(this, AppError.prototype);
    }
}
exports.AppError = AppError;
const errorHandler = (err, _req, res, _next) => {
    const statusCode = err instanceof AppError ? err.statusCode : 500;
    const message = err.message || 'Internal Server Error';
    logger_1.logger.error(err);
    res.status(statusCode).json({
        status: 'error',
        statusCode,
        message,
    });
};
exports.errorHandler = errorHandler;
//# sourceMappingURL=errorHandler.js.map