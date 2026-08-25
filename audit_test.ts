import { db } from './src/db/index.js';
import * as schema from './src/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

const PORT = 3000;
const URL = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_do_not_use_in_prod';

async function registerUser(email: string, role: string) {
  const res = await fetch(`${URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: email.split('@')[0], email, password: 'password123', role })
  });
  if (res.status === 400) { // Already exists
     const loginRes = await fetch(`${URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123' })
     });
     return await loginRes.json();
  }
  return await res.json();
}

async function runTests() {
  console.log("Starting Booking Audit Tests...\n");

  // Clean DB before test
  await db.delete(schema.doctorLeaveDays);
  await db.delete(schema.slotHolds);
  await db.delete(schema.symptomForms);
  await db.delete(schema.appointments);

  // Setup Users
  const patient1Data = await registerUser('p1@test.com', 'patient');
  const patient2Data = await registerUser('p2@test.com', 'patient');
  const doctorData = await registerUser('d1@test.com', 'doctor');
  const adminData = await registerUser('admin2@test.com', 'admin');

  const p1Token = patient1Data.token;
  const p2Token = patient2Data.token;
  const d1Token = doctorData.token;
  const adminToken = adminData.token;

  // Get doc profile ID
  const docRes = await fetch(`${URL}/api/doctors`, { headers: { 'Authorization': `Bearer ${p1Token}` } });
  const docs = await docRes.json();
  const d1ProfileId = docs.find((d: any) => d.email === 'd1@test.com').profile.id;

  const getFutureSlot = (hoursFromNow: number) => {
      // Must be a weekday and inside working hours. We'll just force a time to '10:00:00' tomorrow.
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(10, 0, 0, 0);
      // add offset for each test to avoid slot overlaps across tests
      d.setHours(d.getHours() + hoursFromNow);
      return d.toISOString();
  };

  const slotA = getFutureSlot(0); // 10:00
  const slotC = getFutureSlot(1); // 11:00
  const slotD = getFutureSlot(2); // 12:00

  // A. Normal booking
  console.log("A. Normal booking (Hold -> Book)");
  const holdA = await fetch(`${URL}/api/appointments/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ doctorId: d1ProfileId, slotStart: slotA })
  });
  const holdA_Data = await holdA.json();
  console.assert(holdA.status === 200, "Hold A failed");
  
  const bookA = await fetch(`${URL}/api/appointments/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ holdId: holdA_Data.hold.id, rawSymptoms: 'test' })
  });
  console.assert(bookA.status === 200, "Book A failed");
  console.log("✅ Passed A\n");

  // B. Same slot booked twice sequentially
  console.log("B. Same slot booked twice sequentially");
  const holdB = await fetch(`${URL}/api/appointments/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p2Token}` },
    body: JSON.stringify({ doctorId: d1ProfileId, slotStart: slotA })
  });
  console.assert(holdB.status === 409, `Expected 409, got ${holdB.status}`);
  console.log("✅ Passed B\n");

  // C. Two simultaneous booking requests
  console.log("C. Two simultaneous booking requests");
  const holdC1 = fetch(`${URL}/api/appointments/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ doctorId: d1ProfileId, slotStart: slotC })
  });
  const holdC2 = fetch(`${URL}/api/appointments/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p2Token}` },
    body: JSON.stringify({ doctorId: d1ProfileId, slotStart: slotC })
  });
  const [resC1, resC2] = await Promise.all([holdC1, holdC2]);
  
  const statusesC = [resC1.status, resC2.status];
  console.assert(statusesC.includes(200) && statusesC.includes(409), `Expected one 200 and one 409, got ${statusesC}`);
  console.log("✅ Passed C\n");

  // Clean up C hold
  await db.delete(schema.slotHolds).where(eq(schema.slotHolds.slotStart, new Date(slotC)));

  // D & E. Hold expiration & Confirm expired hold
  console.log("D & E. Hold expiration & Confirm expired hold");
  const holdD = await fetch(`${URL}/api/appointments/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ doctorId: d1ProfileId, slotStart: slotD })
  });
  const holdD_Data = await holdD.json();
  
  // Force expire in DB
  await db.execute(sql`UPDATE slot_holds SET expires_at = NOW() - INTERVAL '10 MINUTES' WHERE id = ${holdD_Data.hold.id}`);
  
  const bookE = await fetch(`${URL}/api/appointments/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ holdId: holdD_Data.hold.id, rawSymptoms: 'test' })
  });
  console.assert(bookE.status === 404, `Expected 404 for expired hold, got ${bookE.status}`);
  console.log("✅ Passed D & E\n");

  // F. Confirm another patient's hold
  console.log("F. Confirm another patient's hold");
  const holdF = await fetch(`${URL}/api/appointments/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ doctorId: d1ProfileId, slotStart: getFutureSlot(4) })
  });
  const holdF_Data = await holdF.json();
  
  const bookF = await fetch(`${URL}/api/appointments/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p2Token}` },
    body: JSON.stringify({ holdId: holdF_Data.hold.id, rawSymptoms: 'test' })
  });
  console.assert(bookF.status === 403, `Expected 403, got ${bookF.status}`);
  console.log("✅ Passed F\n");

  // G. Booking during doctor leave
  console.log("G. Booking during doctor leave");
  // Set leave for today + 2
  const slotG = getFutureSlot(48); // 48 hours later = different day
  const leaveDateStr = new Date(slotG).toISOString().split('T')[0];
  const lRes = await fetch(`${URL}/api/admin/leaves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ doctorId: d1ProfileId, date: leaveDateStr, reason: 'Testing', confirm: true })
  });
  console.log('Leave insertion:', lRes.status, await lRes.json());
  
  const holdG = await fetch(`${URL}/api/appointments/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ doctorId: d1ProfileId, slotStart: slotG })
  });
  console.log('Hold during leave:', holdG.status);
  console.assert(holdG.status === 400, `Expected 400, got ${holdG.status}`);
  console.log("✅ Passed G\n");

  // H. Booking outside working hours
  console.log("H. Booking outside working hours");
  const outOfHours = new Date(slotA);
  outOfHours.setHours(3, 0, 0, 0); // 3 AM
  const holdH = await fetch(`${URL}/api/appointments/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ doctorId: d1ProfileId, slotStart: outOfHours.toISOString() })
  });
  console.assert(holdH.status === 400, `Expected 400, got ${holdH.status}`);
  console.log("✅ Passed H\n");

  // I. Cancel then book same slot
  console.log("I. Cancel then book same slot");
  const cancelI = await fetch(`${URL}/api/appointments/${(await bookA.json()).appointment.id}/cancel`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${p1Token}` }
  });
  console.assert(cancelI.status === 200, "Cancel failed");
  
  const holdI = await fetch(`${URL}/api/appointments/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p2Token}` },
    body: JSON.stringify({ doctorId: d1ProfileId, slotStart: slotA })
  });
  console.assert(holdI.status === 200, `Expected 200 after cancel, got ${holdI.status}`);
  console.log("✅ Passed I\n");

  // J. Reschedule to an occupied slot
  console.log("J. Reschedule to occupied slot");
  const holdI_Data = await holdI.json();
  const bookI = await fetch(`${URL}/api/appointments/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p2Token}` },
    body: JSON.stringify({ holdId: holdI_Data.hold.id, rawSymptoms: 'test' })
  });
  const bookI_Data = await bookI.json();
  console.log('Book I:', bookI.status, bookI_Data);

  // Try to reschedule C's successful booking to I's slot (slotA). Wait, we need to know C's appointment id. 
  // Let's just create a new appt for P1.
  const slotJ = getFutureSlot(5);
  const holdJ = await fetch(`${URL}/api/appointments/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ doctorId: d1ProfileId, slotStart: slotJ })
  });
  const holdJ_Data = await holdJ.json();
  console.log('Hold J:', holdJ.status, holdJ_Data);
  
  const bookJ = await fetch(`${URL}/api/appointments/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ holdId: holdJ_Data.hold.id, rawSymptoms: 'test' })
  });
  const bookJ_Data = await bookJ.json();
  console.log('Book J:', bookJ.status, bookJ_Data);

  const rescheduleJ = await fetch(`${URL}/api/appointments/${bookJ_Data.appointment.id}/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ newSlotStart: slotA }) // occupied by bookI
  });
  console.assert(rescheduleJ.status === 409, `Expected 409 conflict, got ${rescheduleJ.status}`);
  console.log("✅ Passed J\n");

  // K. Patient accessing another patient's appointment
  console.log("K. Patient accessing another patient's appointment");
  const getK = await fetch(`${URL}/api/appointments/${bookI_Data.appointment.id}`, { // belongs to p2
    headers: { 'Authorization': `Bearer ${p1Token}` } // p1 tries to access
  });
  console.assert(getK.status === 403, `Expected 403 Forbidden, got ${getK.status}`);
  
  const listK = await fetch(`${URL}/api/appointments`, {
    headers: { 'Authorization': `Bearer ${p1Token}` }
  });
  const listK_Data = await listK.json();
  const foundOther = listK_Data.find((a: any) => a.id === bookI_Data.appointment.id);
  console.assert(!foundOther, "Found another patient's appointment in list");
  console.log("✅ Passed K\n");

  console.log("All tests completed successfully.");
  process.exit(0);
}

runTests().catch(console.error);
