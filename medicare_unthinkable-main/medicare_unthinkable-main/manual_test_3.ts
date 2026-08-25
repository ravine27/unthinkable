import fetch from 'node-fetch';
async function test() {
  const p1 = await fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'p1@test.com', password: 'password123' })
  });
  const { token: p1Token } = await p1.json();
  
  // Get doctor ID
  const docsRes = await fetch('http://127.0.0.1:3000/api/doctors', {
    headers: { 'Authorization': `Bearer ${p1Token}` }
  });
  const docs = await docsRes.json();
  const myDoctor = docs[1]; // doctor@mediflow.com
  const doctorId = myDoctor.profile.id;

  const d1 = await fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: myDoctor.email, password: 'password123' })
  });
  const { token: d1Token } = await d1.json();
  
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(11, 30, 0, 0); 
  const slotStart = tomorrow.toISOString();
  
  // 1. Patient holds slot
  const holdRes = await fetch('http://127.0.0.1:3000/api/appointments/hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ doctorId, slotStart })
  });
  const holdData = await holdRes.json();
  
  // 2. Patient books slot with symptoms
  const bookRes = await fetch('http://127.0.0.1:3000/api/appointments/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ holdId: holdData.hold.id, rawSymptoms: 'I have a headache and mild fever for 2 days.' })
  });
  const bookData = await bookRes.json();
  const appointmentId = bookData.appointment.id;
  
  // 3. Wait for pre-visit summary
  await new Promise(r => setTimeout(r, 6000));
  
  // 4. Doctor fetches appointment
  const getDocRes = await fetch(`http://127.0.0.1:3000/api/appointments/${appointmentId}`, {
    headers: { 'Authorization': `Bearer ${d1Token}` }
  });
  const docApptData = await getDocRes.json();
  console.log("Doctor Pre-Visit Summary Status:", docApptData.symptomForm?.aiStatus);
  console.log("Urgency:", docApptData.symptomForm?.urgency);
  console.log("Chief Complaint:", docApptData.symptomForm?.chiefComplaint);

  // 5. Doctor completes appointment
  await fetch(`http://127.0.0.1:3000/api/appointments/${appointmentId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${d1Token}` },
    body: JSON.stringify({
      clinicalNotes: 'Patient has mild viral fever. Recommended rest and hydration.',
      prescriptionRaw: 'Paracetamol 500mg SOS',
      followUpInstructions: 'Return in 3 days if fever persists.'
    })
  });
  
  // 6. Wait for post-visit summary
  await new Promise(r => setTimeout(r, 6000));
  
  // 7. Patient fetches appointment
  const getPatRes = await fetch(`http://127.0.0.1:3000/api/appointments/${appointmentId}`, {
    headers: { 'Authorization': `Bearer ${p1Token}` }
  });
  const patApptData = await getPatRes.json();
  console.log("Patient Post-Visit Summary Status:", patApptData.visitNote?.aiStatus);
  console.log("Summary:", patApptData.visitNote?.patientSummary);
}
test().catch(console.error).finally(() => process.exit(0));
