export declare const config: {
    env: "development" | "production" | "test";
    port: number;
    logLevel: "error" | "warn" | "info" | "http" | "debug";
    cors: {
        origin: string;
    };
    jwt: {
        secret: string;
    };
};
