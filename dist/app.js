"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const express_1 = tslib_1.__importDefault(require("express"));
const cors_1 = tslib_1.__importDefault(require("cors"));
const helmet_1 = tslib_1.__importDefault(require("helmet"));
const morgan_1 = tslib_1.__importDefault(require("morgan"));
const configs_1 = require("@/configs");
const cookie_parser_1 = tslib_1.__importDefault(require("cookie-parser"));
const swagger_ui_express_1 = tslib_1.__importDefault(require("swagger-ui-express"));
const swagger_1 = require("@/configs/swagger");
const routes_1 = tslib_1.__importDefault(require("@/routes"));
const errorHandler_1 = require("@/middlewares/errorHandler");
const context_middleware_1 = require("@/middlewares/context.middleware");
const requestLogger_middleware_1 = require("@/middlewares/requestLogger.middleware");
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use((0, morgan_1.default)('dev'));
app.use((0, cors_1.default)({ origin: configs_1.config.cors.origin }));
app.use(express_1.default.json({
    verify: (req, _res, buf) => {
        req.rawBody = buf;
    },
}));
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, cookie_parser_1.default)());
app.use(requestLogger_middleware_1.requestLogger);
app.use(context_middleware_1.contextMiddleware);
app.use('/api-docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swagger_1.swaggerSpec));
app.use('/docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swagger_1.swaggerSpec));
app.use('/api', routes_1.default);
app.use((_req, res) => {
    res.status(404).json({
        status: 'error',
        statusCode: 404,
        message: 'Resource not found',
    });
});
app.use(errorHandler_1.errorHandler);
exports.default = app;
//# sourceMappingURL=app.js.map