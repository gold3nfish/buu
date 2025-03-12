const express = require('express');
const mysql = require('mysql2'); // เปลี่ยนจาก { Pool } เป็น mysql
const fs = require('fs');
const path = require('path');
const qr = require('qr-image');
const promptpay = require('promptpay-qr');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// สร้าง connection pool ด้วย createPool()
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

// ตัวอย่าง query ตรวจสอบการเชื่อมต่อ (คุณสามารถเพิ่มใน initDB หรือทดลองแยกได้)
pool.query('SELECT 1', (err, results) => {
  if (err) {
    console.error('Database connection failed:', err);
  } else {
    console.log('Database connection succeeded.');
  }
});

// 1. ตั้งค่า Database โดยอ่านจาก environment variables (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  database: process.env.DB_NAME || 'qr_code', // ถ้า DB ยังไม่มี สามารถใช้ admin tool สร้างได้ล่วงหน้า
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'FTOedf36275'
});

// 2. สร้างตารางใน database ชื่อ qr_code (ถ้ายังไม่มี)
// ตารางนี้จะเก็บ: promptpay_id, amount และ image_path
async function initDB() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS qr_code (
      id SERIAL PRIMARY KEY,
      promptpay_id VARCHAR(50) NOT NULL,
      amount NUMERIC NOT NULL,
      image_path TEXT NOT NULL
    )
  `;
  await pool.query(createTableQuery);
}
initDB().catch(console.error);

// 3. Route สำหรับหน้าเว็บหลัก (แสดง form สำหรับ generate QR)
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

// 4. Route POST /generate สำหรับสร้าง QR, บันทึกไฟล์ และเก็บ record ลง DB
app.post('/generate', async (req, res) => {
  try {
    const { promptpayId, amount } = req.body;
    if (!promptpayId || !amount) {
      return res.status(400).send('Missing promptpayId or amount');
    }

    // 4.1 ใช้ promptpay-qr generate data สำหรับ QR
    const qrData = promptpay.generate(promptpayId, parseFloat(amount));
    // 4.2 สร้าง QR image เป็น PNG
    const qrPng = qr.imageSync(qrData, { type: 'png' });

    // 4.3 สร้างชื่อไฟล์แบบ unique (ใช้ timestamp)
    const fileName = `qr_${Date.now()}.png`;
    const savePath = path.join('/data', fileName);

    // 4.4 เขียนไฟล์ลง /data
    fs.writeFileSync(savePath, qrPng);

    // 4.5 บันทึกข้อมูลลงตาราง qr_code
    const insertQuery = `
      INSERT INTO qr_code (promptpay_id, amount, image_path)
      VALUES ($1, $2, $3)
      RETURNING id
    `;
    const result = await pool.query(insertQuery, [promptpayId, amount, fileName]);
    const newId = result.rows[0].id;

    res.send(`
      <h2>QR Generated Successfully</h2>
      <p>ID: ${newId}</p>
      <p>PromptPay ID: ${promptpayId}</p>
      <p>Amount: ${amount}</p>
      <p>Image: <a href="/qr-images/${fileName}" target="_blank">View QR Code</a></p>
      <br/>
      <a href="/">Go Back</a> | <a href="/list">View All QR Codes</a>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

// 5. Route GET /list สำหรับแสดงรายการ QR Code ที่สร้างไว้ในรูปแบบ HTML table
app.get('/list', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM qr_code ORDER BY id DESC');
    let html = `<h1>List of Generated QR Codes</h1>`;
    html += `<table border="1" cellpadding="5" cellspacing="0">
               <tr>
                 <th>ID</th>
                 <th>PromptPay ID</th>
                 <th>Amount</th>
                 <th>QR Code Image</th>
               </tr>`;
    result.rows.forEach(row => {
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

// 6. ใช้ express.static เพื่อให้สามารถดึงไฟล์รูปจาก Storage ได้
app.use('/qr-images', express.static('/data'));

// 7. เริ่ม server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
