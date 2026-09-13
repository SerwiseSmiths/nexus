declare global {
    namespace Express {
        interface Request {
            rawBody?: Buffer;
        }
    }
}
declare const app: import("express-serve-static-core").Express;
export default app;
