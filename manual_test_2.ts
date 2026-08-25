import fetch from 'node-fetch';
async function test() {
  const p1 = await fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'p1@test.com', password: 'password123' })
  });
  const { token: p1Token } = await p1.json();
  
  const d1 = await fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'doctor@test.com', password: 'password123' })
  });
  const { token: d1Token, user: docUser } = await d1.json();
  
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(10, 30, 0, 0); // 10:30 AM
  const slotStart = tomorrow.toISOString();
  
  // 1. Patient holds slot
  const holdRes = await fetch('http://127.0.0.1:3000/api/appointments/hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ doctorId: 1, slotStart })
  });
  const holdData = await holdRes.json();
  if (holdRes.status !== 200) throw new Error("Hold failed");

  // 2. Patient books slot with symptoms
  const bookRes = await fetch('http://127.0.0.1:3000/api/appointments/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ holdId: holdData.hold.id, rawSymptoms: 'I have a headache and mild fever for 2 days.' })
  });
  const bookData = await bookRes.json();
  if (bookRes.status !== 200) throw new Error("Book failed");
  const appointmentId = bookData.appointment.id;
  
  console.log("Booked Appointment:", appointmentId);
  
  // 3. Wait for pre-visit summary to be generated (wait 5s)
  console.log("Waiting for Pre-Visit Summary generation...");
  await new Promise(r => setTimeout(r, 5000));
  
  // 4. Doctor fetches appointment to see pre-visit summary
  const getDocRes = await fetch(`http://127.0.0.1:3000/api/appointments/${appointmentId}`, {
    headers: { 'Authorization': `Bearer ${d1Token}` }
  });
  const docApptData = await getDocRes.json();
  console.log("Doctor View (Pre-Visit):", JSON.stringify(docApptData.symptomForm, null, 2));

  // 5. Doctor completes appointment
  const completeRes = await fetch(`http://127.0.0.1:3000/api/appointments/${appointmentId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${d1Token}` },
    body: JSON.stringify({
      clinicalNotes: 'Patient has mild viral fever. Recommended rest and hydration.',
      prescriptionRaw: 'Paracetamol 500mg SOS',
      followUpInstructions: 'Return in 3 days if fever persists.'
    })
  });
  const completeData = await completeRes.json();
  console.log("Complete Status:", completeRes.status, completeData);
  
  // 6. Wait for post-visit summary to be generated (wait 5s)
  console.log("Waiting for Post-Visit Summary generation...");
  await new Promise(r => setTimeout(r, 5000));
  
  // 7. Patient fetches appointment to see post-visit summary
  const getPatRes = await fetch(`http://127.0.0.1:3000/api/appointments/${appointmentId}`, {
    headers: { 'Authorization': `Bearer ${p1Token}` }
  });
  const patApptData = await getPatRes.json();
  console.log("Patient View (Post-Visit):", JSON.stringify(patApptData.visitNote, null, 2));
}
test().catch(console.error).finally(() => process.exit(0));
