require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const qr = require('qr-image');
const promptpay = require('promptpay-qr');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database configuration
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Check database connection
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    console.log('Database connection succeeded.');
    connection.release();
  } catch (err) {
    console.error('Database connection failed:', err);
    process.exit(1); // Terminate the app if the database connection fails
  }
}
testConnection();

// Initialize database (create table if not exists)
async function initDB() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS qr_code (
      id INT AUTO_INCREMENT PRIMARY KEY,
      promptpay_id VARCHAR(50) NOT NULL,
      amount DECIMAL(10, 2) NOT NULL,
      image_path TEXT NOT NULL
    )`;
  try {
    await pool.query(createTableQuery);
  } catch (err) {
    console.error('Failed to create table:', err);
  }
}
initDB().catch(console.error);

// Serve static QR images from ./data
const imageDir = path.join(__dirname, 'data');
if (!fs.existsSync(imageDir)) fs.mkdirSync(imageDir);
app.use('/qr-images', express.static(imageDir));

// Main page route (QR generation form)
app.get('/', (req, res) => {
  res.send(`
    <h1>Generate PromptPay QR Code</h1>
    <form method="POST" action="/generate">
      <label>PromptPay ID:</label><br/>
      <input type="text" name="promptpayId" required /><br/><br/>
      <label>Amount:</label><br/>
      <input type="number" name="amount" step="0.01" required /><br/><br/>
      <button type="submit">Generate QR</button>
    </form>
    <br/>
    <a href="/list">View QR List</a>
  `);
});

// Route to generate QR code
app.post('/generate', async (req, res) => {
  const { promptpayId, amount } = req.body;
  if (!promptpayId || !amount) {
    return res.status(400).send('Missing promptpayId or amount');
  }

  try {
    const qrData = promptpay.generate(promptpayId, parseFloat(amount));
    const qrPng = qr.imageSync(qrData, { type: 'png' });

    const fileName = `qr_${Date.now()}.png`;
    const savePath = path.join(imageDir, fileName);

    fs.writeFileSync(savePath, qrPng);

    const insertQuery = `
      INSERT INTO qr_code (promptpay_id, amount, image_path)
      VALUES (?, ?, ?)`;
    const [result] = await pool.execute(insertQuery, [promptpayId, amount, fileName]);

    res.send(`
      <h2>QR Generated Successfully</h2>
      <p>ID: ${result.insertId}</p>
      <p>PromptPay ID: ${promptpayId}</p>
      <p>Amount: ${amount}</p>
      <p>Image: <a href="/qr-images/${fileName}" target="_blank">View QR Code</a></p>
      <br/>
      <a href="/">Go Back</a> | <a href="/list">View All QR Codes</a>
    `);
  } catch (err) {
    console.error('Error during QR generation:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Route to list generated QR codes
app.get('/list', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM qr_code ORDER BY id DESC');
    let html = `<h1>List of Generated QR Codes</h1>`;
    html += `<table border="1" cellpadding="5" cellspacing="0">
              <tr>
                <th>ID</th>
                <th>PromptPay ID</th>
                <th>Amount</th>
                <th>QR Code Image</th>
              </tr>`;

    rows.forEach(row => {
      html += `<tr>
                <td>${row.id}</td>
                <td>${row.promptpay_id}</td>
                <td>${row.amount}</td>
                <td><a href="/qr-images/${row.image_path}" target="_blank">View Image</a></td>
              </tr>`;
    });

    html += `</table><br/><a href="/">Go Back</a>`;
    res.send(html);
  } catch (err) {
    console.error('Error fetching QR list:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
