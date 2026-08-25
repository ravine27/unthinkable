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
  console.log(docs);
}
test();
