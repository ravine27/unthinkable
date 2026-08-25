import fetch from 'node-fetch';
async function test() {
  const p1 = await fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'p1@test.com', password: 'password123' })
  });
  const { token: p1Token } = await p1.json();
  
  const docsRes = await fetch('http://127.0.0.1:3000/api/doctors', {
    headers: { 'Authorization': `Bearer ${p1Token}` }
  });
  const docs = await docsRes.json();
  const myDoctor = docs.find((d: any) => d.email === 'd1@test.com');
  const doctorId = myDoctor.profile.id;

  const d1 = await fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: myDoctor.email, password: 'password123' })
  });
  const d1LoginData = await d1.json();
  if (!d1.ok) throw new Error("Doctor login failed: " + JSON.stringify(d1LoginData));
  const { token: d1Token } = d1LoginData;
  
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(13, 0, 0, 0); 
  const slotStart = tomorrow.toISOString();
  
  // 1. Patient holds slot
  const holdRes = await fetch('http://127.0.0.1:3000/api/appointments/hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ doctorId, slotStart })
  });
  const holdData = await holdRes.json();
  if (!holdRes.ok) throw new Error("Hold failed: " + JSON.stringify(holdData));
  
  // 2. Patient books slot with symptoms
  const bookRes = await fetch('http://127.0.0.1:3000/api/appointments/book', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p1Token}` },
    body: JSON.stringify({ holdId: holdData.hold.id, rawSymptoms: 'I have a headache and mild fever for 2 days.' })
  });
  const bookData = await bookRes.json();
  if (!bookRes.ok) throw new Error("Book failed: " + JSON.stringify(bookData));
  const appointmentId = bookData.appointment.id;
  
  console.log("Booked Appointment:", appointmentId);
  
  // 3. Wait for pre-visit summary
  console.log("Waiting for Pre-Visit Summary generation...");
  await new Promise(r => setTimeout(r, 6000));
  
  // 4. Doctor fetches appointment
  const getDocRes = await fetch(`http://127.0.0.1:3000/api/appointments/${appointmentId}`, {
    headers: { 'Authorization': `Bearer ${d1Token}` }
  });
  const docApptData = await getDocRes.json();
  console.log("Doctor Pre-Visit Summary Status:", docApptData.symptomForm?.aiStatus);
  console.log("Urgency:", docApptData.symptomForm?.urgency);
  console.log("Chief Complaint:", docApptData.symptomForm?.chiefComplaint);
  console.log("Questions:", docApptData.symptomForm?.suggestedQuestions);

  // 5. Doctor completes appointment
  console.log("Doctor completing appointment...");
  const completeRes = await fetch(`http://127.0.0.1:3000/api/appointments/${appointmentId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${d1Token}` },
    body: JSON.stringify({
      clinicalNotes: 'Patient has mild viral fever. Recommended rest and hydration.',
      prescriptionRaw: 'Paracetamol 500mg SOS',
      followUpInstructions: 'Return in 3 days if fever persists.'
    })
  });
  if (!completeRes.ok) throw new Error("Complete failed: " + await completeRes.text());
  
  // 6. Wait for post-visit summary
  console.log("Waiting for Post-Visit Summary generation...");
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
