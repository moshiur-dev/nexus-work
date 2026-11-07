import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';

export function signTokens(userId) {
  const accessToken = jwt.sign({ sub: String(userId) }, process.env.JWT_ACCESS_SECRET, { expiresIn: ACCESS_TTL });
  const refreshToken = jwt.sign({ sub: String(userId) }, process.env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL });
  return { accessToken, refreshToken };
}

export async function registerUser({ name, email, password, workspaceName }) {
  const exists = await User.findOne({ email });
  if (exists) {
    const err = new Error('An account with this email already exists');
    err.status = 409;
    err.expose = true;
    throw err;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  return User.create({ name, email, passwordHash, workspaceName });
}

export async function loginUser({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) {
    const err = new Error('Email or password is incorrect');
    err.status = 401;
    err.expose = true;
    throw err;
  }
  return user;
}
