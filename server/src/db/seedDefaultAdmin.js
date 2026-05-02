import bcrypt from 'bcryptjs';
import { Admin } from '../models/index.js';
import { config } from '../config.js';
import { normalizeGhanaMsisdn } from '../utils/phoneGhana.js';

/** Creates the main admin when the database has no administrators yet. */
export async function seedDefaultAdmin() {
  const existing = await Admin.countDocuments();
  if (existing > 0) return { seeded: false };

  const { email, password, phone, fullName } = config.defaultAdmin;
  if (!email || !password) {
    console.warn('[QareFi] No default admin credentials; use POST /api/auth/setup or set env.');
    return { seeded: false };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  let phoneNorm = '';
  if (phone && String(phone).trim()) {
    const n = normalizeGhanaMsisdn(String(phone).trim());
    if (n) phoneNorm = n;
  }
  await Admin.create({
    email: email.toLowerCase().trim(),
    fullName: fullName ? String(fullName).trim() : '',
    passwordHash,
    phone: phoneNorm,
    role: 'super_admin',
    organizationId: null,
  });
  console.log(`[QareFi] Default administrator ready: ${email}`);
  return { seeded: true, email };
}
