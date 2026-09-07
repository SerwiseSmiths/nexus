import prisma from '@/services/prisma.service';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetDeviceTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser, VALID_METADATA } from './fixtures';

describe('PATCH /api/device/:id', () => {
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

  async function addDevice(token: string, deviceKey = 'fridge') {
    const res = await testRequest(app)
      .post('/api/device')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceKey, metadata: VALID_METADATA[deviceKey] });
    return res.body.data.device;
  }

  it('updates imageUrl only, leaving metadata untouched', async () => {
    const user = await createUser();
    const token = signAccessToken(user);
    const device = await addDevice(token, 'fridge');

    const res = await testRequest(app)
      .patch(`/api/device/${device.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ imageUrl: 'https://example.com/fridge.jpg' });

    expect(res.status).toBe(200);
    expect(res.body.data.device.imageUrl).toBe('https://example.com/fridge.jpg');
    expect(res.body.data.device.metadata).toMatchObject({ company: 'Samsung' });
  });

  it('updates metadata, validated against the device\'s own deviceKey schema', async () => {
    const user = await createUser();
    const token = signAccessToken(user);
    const device = await addDevice(token, 'fridge');

    const res = await testRequest(app)
      .patch(`/api/device/${device.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ metadata: { ...VALID_METADATA.fridge, capacityLtr: 500 } });

    expect(res.status).toBe(200);
    expect(res.body.data.device.metadata.capacityLtr).toBe(500);
  });

  it('rejects metadata shaped for a different deviceKey with 400', async () => {
    const user = await createUser();
    const token = signAccessToken(user);
    const device = await addDevice(token, 'fridge');

    const res = await testRequest(app)
      .patch(`/api/device/${device.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ metadata: VALID_METADATA.washing_machine });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^\w+: /);
  });

  it('rejects an unparseable purchaseDate on update with 400', async () => {
    const user = await createUser();
    const token = signAccessToken(user);
    const device = await addDevice(token, 'fridge');

    const res = await testRequest(app)
      .patch(`/api/device/${device.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ metadata: { ...VALID_METADATA.fridge, purchaseDate: 'garbage' } });

    expect(res.status).toBe(400);
  });

  it('returns 404 when updating a device owned by another user', async () => {
    const owner = await createUser();
    const other = await createUser();
    const ownerToken = signAccessToken(owner);
    const otherToken = signAccessToken(other);
    const device = await addDevice(ownerToken, 'fridge');

    const res = await testRequest(app)
      .patch(`/api/device/${device.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ imageUrl: 'https://example.com/hijack.jpg' });

    expect(res.status).toBe(404);

    const stillOriginal = await prisma.device.findUnique({ where: { id: device.id } });
    expect(stillOriginal?.imageUrl).toBeNull();
  });

  it('returns 404 for a non-existent device id', async () => {
    const user = await createUser();
    const token = signAccessToken(user);

    const res = await testRequest(app)
      .patch('/api/device/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ imageUrl: 'https://example.com/x.jpg' });

    expect(res.status).toBe(404);
  });
});
