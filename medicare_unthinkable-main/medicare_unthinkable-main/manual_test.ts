import fetch from 'node-fetch';
async function test() {
  const loginRes = await fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'p1@test.com', password: 'password123' })
  });
  const { token } = await loginRes.json();
  console.log("Logged in");
  
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(10, 0, 0, 0);
  const slotStart = tomorrow.toISOString();

  console.log("Trying to book slot:", slotStart);
  
  const holdRes = await fetch('http://127.0.0.1:3000/api/appointments/hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ doctorId: 1, slotStart })
  });
  const holdData = await holdRes.json();
  console.log("Hold Status:", holdRes.status, holdData);

  if (holdRes.status === 200) {
    const bookRes = await fetch('http://127.0.0.1:3000/api/appointments/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ holdId: holdData.hold.id, rawSymptoms: 'Headache' })
    });
    const bookData = await bookRes.json();
    console.log("Book Status:", bookRes.status, bookData);
  }

  // Verify it appears in My Appointments
  const getRes = await fetch('http://127.0.0.1:3000/api/appointments', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log("Appointments List Status:", getRes.status);
  const getList = await getRes.json();
  console.log("Appointments:", getList.map((a: any) => ({ id: a.id, status: a.status })));
  
  // Try occupied
  const holdRes2 = await fetch('http://127.0.0.1:3000/api/appointments/hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ doctorId: 1, slotStart })
  });
  console.log("Occupied Hold Status:", holdRes2.status, await holdRes2.json());
}
test().catch(console.error).finally(() => process.exit(0));
