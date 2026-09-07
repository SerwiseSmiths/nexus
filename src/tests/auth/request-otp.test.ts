import { testRequest } from '../apiClient';
import { getTestApp } from '../testApp';
import { resetAuthTables } from '../dbHelpers';
import prisma from '@/services/prisma.service';

jest.mock('@/services/hanuotp.service', () => ({
  sendOtpSms: jest.fn(),
}));
import { sendOtpSms } from '@/services/hanuotp.service';
const mockSendOtpSms = sendOtpSms as jest.Mock;

describe('POST /api/auth/request-otp', () => {
  let app: import('express').Express;

  beforeAll(async () => {
    app = await getTestApp();
  });

  beforeEach(async () => {
    await resetAuthTables();
    mockSendOtpSms.mockResolvedValue({ success: true });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('sends an OTP for a valid, non-test phone number', async () => {
    const res = await testRequest(app)
      .post('/api/auth/request-otp')
      .send({ phoneNo: '9998887770' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, statusCode: 200, message: 'OTP sent successfully' });
    expect(mockSendOtpSms).toHaveBeenCalledTimes(1);

    const otpRow = await prisma.otp.findUnique({ where: { phoneNo: '9998887770' } });
    expect(otpRow).not.toBeNull();
    expect(otpRow?.otp).not.toBe(''); // hashed, not stored in plaintext
  });

  it('rejects a missing phoneNo with a specific 400 message', async () => {
    const res = await testRequest(app).post('/api/auth/request-otp').send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, statusCode: 400, message: 'Phone number is required' });
    expect(mockSendOtpSms).not.toHaveBeenCalled();
  });

  it.each(['12345', 'abcdefghij', '99988877701', '+919998887770', ''])(
    'rejects a malformed phoneNo (%s) with a friendly 400 message',
    async (phoneNo) => {
      const res = await testRequest(app).post('/api/auth/request-otp').send({ phoneNo });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(
        phoneNo === '' ? 'Phone number is required' : 'Please enter a valid 10-digit phone number'
      );
      expect(mockSendOtpSms).not.toHaveBeenCalled();
    }
  );

  it('never calls the SMS provider for known test phone numbers, in any environment', async () => {
    const res = await testRequest(app)
      .post('/api/auth/request-otp')
      .send({ phoneNo: '1234567890' });

    expect(res.status).toBe(200);
    expect(mockSendOtpSms).not.toHaveBeenCalled();

    const otpRow = await prisma.otp.findUnique({ where: { phoneNo: '1234567890' } });
    expect(otpRow).not.toBeNull();
  });

  it('overwrites a previous unexpired OTP when requested again for the same phone', async () => {
    await testRequest(app).post('/api/auth/request-otp').send({ phoneNo: '9998887770' });
    const first = await prisma.otp.findUnique({ where: { phoneNo: '9998887770' } });

    await testRequest(app).post('/api/auth/request-otp').send({ phoneNo: '9998887770' });
    const second = await prisma.otp.findUnique({ where: { phoneNo: '9998887770' } });

    expect(second?.otp).not.toBe(first?.otp);
    expect(second?.attempts).toBe(0);
  });

  it('returns 502 with a clear message when the SMS provider fails', async () => {
    mockSendOtpSms.mockResolvedValue({ success: false, error: 'Provider timeout' });

    const res = await testRequest(app)
      .post('/api/auth/request-otp')
      .send({ phoneNo: '9998887771' });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ success: false, statusCode: 502, message: 'Failed to send OTP. Please try again.' });
  });
});
