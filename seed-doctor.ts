import { db } from './src/db/index.js';
import * as schema from './src/db/schema.js';
import bcrypt from 'bcryptjs';

async function seedDoctor() {
  try {
    const passwordHash = await bcrypt.hash('doctor123', 10);
    const [user] = await db.insert(schema.users).values({
      role: 'doctor',
      name: 'Dr. Sarah Jenkins',
      email: 'doctor@mediflow.com',
      passwordHash
    }).returning();
    
    await db.insert(schema.doctorProfiles).values({
      userId: user.id,
      specialisation: 'Cardiology',
      workingHoursStart: '09:00',
      workingHoursEnd: '17:00',
      slotDurationMinutes: 30
    });
    
    console.log('Success! Test doctor created with email:', user.email);
  } catch (e: any) {
    console.error('Error:', e.message);
  }
  process.exit(0);
}

seedDoctor();
