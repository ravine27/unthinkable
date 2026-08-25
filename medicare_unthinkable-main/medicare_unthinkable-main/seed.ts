import { db } from './src/db/index.js';
import * as schema from './src/db/schema.js';
import bcrypt from 'bcryptjs';

async function seedAdmin() {
  try {
    const passwordHash = await bcrypt.hash('admin123', 10);
    const [user] = await db.insert(schema.users).values({
      role: 'admin',
      name: 'System Admin',
      email: 'admin@mediflow.com',
      passwordHash
    }).returning();
    console.log('Success! Admin created with email:', user.email);
  } catch (e: any) {
    if (e.code === '23505') { // Unique violation
      console.log('Admin already exists.');
    } else {
      console.error('Error:', e);
    }
  }
  process.exit(0);
}

seedAdmin();
