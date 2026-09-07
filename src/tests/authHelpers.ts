import jwt from 'jsonwebtoken';
import { config } from '@/configs';
import { Role } from '@prisma/client';

export function signAccessToken(user: { id: string; phoneNo: string; role: Role }) {
  return jwt.sign(
    { id: user.id, phoneNo: user.phoneNo, role: user.role },
    config.jwt.secret as jwt.Secret,
    { expiresIn: '30d' },
  );
}
