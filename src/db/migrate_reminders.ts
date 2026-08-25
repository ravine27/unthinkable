import { db } from './index.js';
import { sql } from 'drizzle-orm';

async function migrate() {
  console.log('Fixing medication_reminders column nullability...');
  
  await db.execute(sql`
    ALTER TABLE medication_reminders ALTER COLUMN visit_note_id DROP NOT NULL;
    ALTER TABLE medication_reminders ALTER COLUMN schedule_time DROP NOT NULL;
  `);

  console.log('Column constraints updated successfully.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration fix failed:', err);
  process.exit(1);
});
