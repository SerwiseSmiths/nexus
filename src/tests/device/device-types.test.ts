import prisma from '@/services/prisma.service';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetDeviceTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser } from './fixtures';

jest.mock('@/services/strapi.service', () => ({
  StrapiService: { fetchDeviceTypes: jest.fn() },
}));

import { StrapiService } from '@/services/strapi.service';

describe('GET /api/device-types', () => {
  let app: import('express').Express;

  beforeAll(async () => {
    app = await getTestApp();
  });

  beforeEach(async () => {
    await resetDeviceTables();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns the device type catalog from Strapi', async () => {
    const catalog = [
      { documentId: '1', key: 'air_conditioner', label: 'Air Conditioner', iconUrl: 'https://cdn.example.com/ac.png' },
      { documentId: '2', key: 'fridge', label: 'Fridge', iconUrl: null },
    ];
    (StrapiService.fetchDeviceTypes as jest.Mock).mockResolvedValue(catalog);

    const user = await createUser();
    const token = signAccessToken(user);

    const res = await testRequest(app).get('/api/device-types').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, statusCode: 200, message: 'Device types fetched successfully' });
    expect(res.body.data).toEqual(catalog);
  });

  it('propagates a Strapi/CMS failure as a 500 rather than silently returning an empty catalog', async () => {
    (StrapiService.fetchDeviceTypes as jest.Mock).mockRejectedValue(new Error('CMS unavailable'));

    const user = await createUser();
    const token = signAccessToken(user);

    const res = await testRequest(app).get('/api/device-types').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('CMS unavailable');
  });

  it('rejects with 401 when no token is provided', async () => {
    const res = await testRequest(app).get('/api/device-types');
    expect(res.status).toBe(401);
  });
});
