import prisma from '@/services/prisma.service';
import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetDeviceTables } from '../dbHelpers';
import { signAccessToken } from '../authHelpers';
import { createUser, VALID_METADATA } from './fixtures';

describe('POST /api/device', () => {
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

  it.each(Object.keys(VALID_METADATA))(
    'adds a %s device and auto-records PURCHASED + INSTALLED work history',
    async (deviceKey) => {
      const user = await createUser();
      const token = signAccessToken(user);

      const res = await testRequest(app)
        .post('/api/device')
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceKey, metadata: VALID_METADATA[deviceKey] });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ success: true, statusCode: 201, message: 'Device added successfully' });
      expect(res.body.data.device.deviceKey).toBe(deviceKey);
      expect(res.body.data.device.userId).toBe(user.id);

      const history = await prisma.deviceWorkHistory.findMany({ where: { deviceId: res.body.data.device.id } });
      const events = history.map((h) => h.event).sort();
      expect(events).toEqual(['INSTALLED', 'PURCHASED'].sort());
    },
  );

  it('rejects a missing deviceKey with 400', async () => {
    const user = await createUser();
    const token = signAccessToken(user);

    const res = await testRequest(app)
      .post('/api/device')
      .set('Authorization', `Bearer ${token}`)
      .send({ metadata: {} });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('deviceKey is required');
  });

  it('rejects missing metadata with 400', async () => {
    const user = await createUser();
    const token = signAccessToken(user);

    const res = await testRequest(app)
      .post('/api/device')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceKey: 'air_conditioner' });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('metadata is required');
  });

  it('rejects an unknown deviceKey with 400', async () => {
    const user = await createUser();
    const token = signAccessToken(user);

    const res = await testRequest(app)
      .post('/api/device')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceKey: 'toaster', metadata: {} });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Unknown device key: toaster');
  });

  it('rejects metadata missing a required field with 400 and validation issues', async () => {
    const user = await createUser();
    const token = signAccessToken(user);
    const { company: _drop, ...incomplete } = VALID_METADATA.air_conditioner;

    const res = await testRequest(app)
      .post('/api/device')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceKey: 'air_conditioner', metadata: incomplete });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^company: /);
    expect(res.body.data).toEqual(expect.any(Array));
  });

  it('rejects a starRating out of the 0-5 range with 400', async () => {
    const user = await createUser();
    const token = signAccessToken(user);

    const res = await testRequest(app)
      .post('/api/device')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceKey: 'air_conditioner', metadata: { ...VALID_METADATA.air_conditioner, starRating: 7 } });

    expect(res.status).toBe(400);
  });

  it('rejects a malformed starRatingImageUrl with 400', async () => {
    const user = await createUser();
    const token = signAccessToken(user);

    const res = await testRequest(app)
      .post('/api/device')
      .set('Authorization', `Bearer ${token}`)
      .send({
        deviceKey: 'air_conditioner',
        metadata: { ...VALID_METADATA.air_conditioner, starRatingImageUrl: 'not-a-url' },
      });

    expect(res.status).toBe(400);
  });

  it.each(['21-01-2025', '2025/01/21', 'not-a-date', '2025-13-01', ''])(
    'rejects an unparseable purchaseDate (%s) with 400 instead of silently defaulting',
    async (purchaseDate) => {
      const user = await createUser();
      const token = signAccessToken(user);

      const res = await testRequest(app)
        .post('/api/device')
        .set('Authorization', `Bearer ${token}`)
        .send({ deviceKey: 'fridge', metadata: { ...VALID_METADATA.fridge, purchaseDate } });

      expect(res.status).toBe(400);
    },
  );

  it('accepts a month-precision purchaseDate ("YYYY-MM")', async () => {
    const user = await createUser();
    const token = signAccessToken(user);

    const res = await testRequest(app)
      .post('/api/device')
      .set('Authorization', `Bearer ${token}`)
      .send({ deviceKey: 'geyser', metadata: { ...VALID_METADATA.geyser, purchaseDate: '2024-06' } });

    expect(res.status).toBe(201);
  });

  it('rejects the request with 401 when no token is provided', async () => {
    const res = await testRequest(app)
      .post('/api/device')
      .send({ deviceKey: 'fridge', metadata: VALID_METADATA.fridge });

    expect(res.status).toBe(401);
  });
});
