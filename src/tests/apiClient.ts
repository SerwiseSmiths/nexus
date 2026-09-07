import request from 'supertest';
import { Express } from 'express';

// Every route (except the Razorpay webhook and OTA endpoints) requires an
// `x-app-id` header via contextMiddleware — unrelated to auth, but required
// for any request to reach the auth routes/middleware at all.
export function testRequest(app: Express) {
  return {
    post:   (url: string) => request(app).post(url).set('x-app-id', 'serwise-app'),
    get:    (url: string) => request(app).get(url).set('x-app-id', 'serwise-app'),
    patch:  (url: string) => request(app).patch(url).set('x-app-id', 'serwise-app'),
    delete: (url: string) => request(app).delete(url).set('x-app-id', 'serwise-app'),
  };
}
