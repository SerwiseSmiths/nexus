// 10 plain digits, no country code/spaces/punctuation — matches the format already
// assumed everywhere else (TEST_PHONES, HanuOTP normalization). Deliberately not
// restricted to the [6-9] Indian mobile prefix range: TEST_PHONES includes
// "1234567890", which must keep working in every environment including prod.
const PHONE_REGEX = /^\d{10}$/;
const OTP_REGEX = /^\d{6}$/;

export function isValidPhoneNo(phoneNo: unknown): phoneNo is string {
  return typeof phoneNo === 'string' && PHONE_REGEX.test(phoneNo);
}

export function isValidOtp(otp: unknown): otp is string {
  return typeof otp === 'string' && OTP_REGEX.test(otp);
}
