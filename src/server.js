const express = require('express');
const app = express();

// WAJIB: Ambil port dari PieHost, jika kosong gunakan 3000
const PORT = process.env.PORT || 3000;
// WAJIB: Bind ke 0.0.0.0 agar dikenali oleh Load Balancer PieHost
const HOST = '0.0.0.0';

app.get('/', (req, res) => {
  res.send('Server Node.js berjalan sukses di PieHost!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Test server is running' });
});

// Tangkap semua error agar server tidak mati (crash)
process.on('uncaughtException', (err) => {
  console.error('Error tidak tertangkap:', err.message);
});

app.listen(PORT, HOST, () => {
  console.log(`Test server jalan di http://${HOST}:${PORT}`);
});
