require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise'); // Use promise version of mysql2
const fs = require('fs');
const path = require('path');
const qrImage = require('qr-image');
const generatePayload = require('promptpay-qr'); // Using generatePayload from promptpay-qr

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database configuration
const pool = mysql.createPool({
  host: process.env.DB_HOST,    // e.g., 'your-db-host'
  port: process.env.DB_PORT,    // e.g., 3306
  database: process.env.DB_NAME, // e.g., 'qr_code'
  user: process.env.DB_USER,     // e.g., 'root'
  password: process.env.DB_PASSWORD  // e.g., 'your_password'
});

// Check database connection
async function testConnection() {
  try {
    await pool.query('SELECT 1');
    console.log('Database connection succeeded.');
  } catch (err) {
    console.error('Database connection failed:', err);
  }
}
testConnection();

// Initialize database (create table if not exists)
async function initDB() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS qr_code (
      id INT AUTO_INCREMENT PRIMARY KEY,
      promptpay_id VARCHAR(50) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      image_path TEXT NOT NULL
    )`;
  await pool.query(createTableQuery);
}
initDB().catch(console.error);

// Serve static QR images from the ./data directory
const imageDir = path.join(__dirname, 'data');
if (!fs.existsSync(imageDir)) fs.mkdirSync(imageDir);
app.use('/qr-images', express.static(imageDir));

// Middleware: Verify Basic Auth header
function verifyBasicAuth(req) {
  const authHeader = req.headers['authorization'];
  const fixedAuthValue = 'Basic MDk2ODI1NjM2NTU6'; // Hardcoded Base64 value
  return authHeader === fixedAuthValue;
}

// Helper function: Convert text to integer (for amount)
function convertTextToInt(text) {
  const num = parseInt(text, 10);
  if (isNaN(num)) {
    throw new Error('Invalid amount provided');
  }
  return num;
}

// Route: API endpoint to generate PromptPay QR code, save image and record to DB
app.post('/generate', async (req, res) => {
  // Only POST allowed
  if (!verifyBasicAuth(req)) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  let promptpayId = req.body.promptpayId;
  let amount;
  try {
    if (!promptpayId) {
      throw new Error('PromptPay ID is required');
    }
    if (!req.body.amount) {
      throw new Error('Amount is required');
    }
    amount = convertTextToInt(req.body.amount);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  try {
    // Generate PromptPay QR payload using the inserted PromptPay ID and amount
    const payload = generatePayload(promptpayId, { amount });
    // Generate a QR code image (PNG) as a buffer
    const qrPngBuffer = qrImage.imageSync(payload, { type: 'png' });

    // Create a unique filename for the QR image
    const fileName = `qr_${Date.now()}.png`;
    const savePath = path.join(imageDir, fileName);

    // Write the QR image to disk
    fs.writeFileSync(savePath, qrPngBuffer);

    // Insert record into database
    const insertQuery = `
      INSERT INTO qr_code (promptpay_id, amount, image_path)
      VALUES (?, ?, ?)
    `;
    const [result] = await pool.execute(insertQuery, [promptpayId, amount, fileName]);

    // Set response header to image/png and send the generated image
    res.setHeader('Content-Type', 'image/png');
    return res.send(qrPngBuffer);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Error generating QR code', error: error.message });
  }
});

// A simple HTML form for testing (optional)
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

// Route: List generated QR codes (records) with links to view images
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
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
