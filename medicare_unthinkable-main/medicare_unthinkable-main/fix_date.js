const tomorrow = new Date();
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
tomorrow.setUTCHours(10, 0, 0, 0);
console.log(tomorrow.toISOString());
