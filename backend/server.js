require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
const PORT = Number(process.env.PORT || 4000);
const ARG_TZ = 'America/Argentina/Buenos_Aires';
const excelPath = path.resolve(__dirname, process.env.EXCEL_PATH || './data/Control_de_Armado.xlsx');
fs.mkdirSync(path.dirname(excelPath), { recursive: true });

function argentinaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ARG_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function carrierForBarcode(barcode) {
  if (/^\d{15}$/.test(barcode)) return 'Andreani';
  if (/^[A-Z0-9]{18}$/i.test(barcode)) return 'Correo';
  return 'Sin identificar';
}

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Sesión inválida o vencida.' }); }
}
function admin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Se requiere permiso de administrador.' });
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'Control de Armado' }));

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Ingresá usuario y contraseña.' });
    const [rows] = await db.execute('SELECT id,username,password_hash,full_name,role,active FROM users WHERE username=?', [username]);
    const u = rows[0];
    if (!u || !u.active || !(await bcrypt.compare(password, u.password_hash))) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    const token = jwt.sign({ id: u.id, username: u.username, name: u.full_name, role: u.role }, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, user: { id: u.id, username: u.username, name: u.full_name, role: u.role } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error al iniciar sesión.' }); }
});

// Regenera el libro desde MySQL: evita que dos PCs pierdan filas por escrituras simultáneas.
let excelQueue = Promise.resolve();
function refreshExcel() {
  excelQueue = excelQueue.then(async () => {
    const [rows] = await db.execute(`SELECT DATE_FORMAT(s.scanned_at,'%Y-%m-%d') AS day,
      DATE_FORMAT(s.scanned_at,'%H:%i:%s') AS time, u.full_name AS worker,
      s.barcode, COALESCE(s.product_name,'') AS product
      FROM scans s JOIN users u ON u.id=s.user_id ORDER BY s.scanned_at, s.id`);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Control de Armado';
    const grouped = new Map();
    for (const r of rows) { if (!grouped.has(r.day)) grouped.set(r.day, []); grouped.get(r.day).push(r); }
    if (!grouped.size) grouped.set(argentinaDateKey(), []);
    for (const [day, items] of grouped) {
      const ws = wb.addWorksheet(day);
      ws.columns = [
        { header: 'Hora', key: 'time', width: 14 },
        { header: 'Trabajador', key: 'worker', width: 24 },
        { header: 'Código de barras', key: 'barcode', width: 22 },
        { header: 'Correo', key: 'carrier', width: 18 },
        { header: 'Producto', key: 'product', width: 32 }
      ];
      ws.getRow(1).font = { bold: true };
      items.forEach(x => ws.addRow({ ...x, carrier: carrierForBarcode(x.barcode) }));
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    }
    const tmp = excelPath + '.tmp.xlsx';
    await wb.xlsx.writeFile(tmp);
    try { fs.renameSync(tmp, excelPath); } catch { fs.copyFileSync(tmp, excelPath); fs.unlinkSync(tmp); }
  });
  return excelQueue;
}

app.post('/api/scans', auth, async (req, res) => {
  try {
    const barcode = String(req.body.barcode || '').trim();
    if (!barcode) return res.status(400).json({ error: 'No se recibió un código de barras.' });

    const [duplicate] = await db.execute(
      'SELECT id FROM scans WHERE barcode=? AND DATE(scanned_at)=DATE(NOW()) LIMIT 1',
      [barcode]
    );
    if (duplicate.length) {
      return res.status(409).json({ error: 'Pedido ya ticado.', duplicate: true, barcode });
    }

    const [products] = await db.execute('SELECT name FROM products WHERE barcode=?', [barcode]);
    const productName = products[0]?.name || null;
    const [result] = await db.execute('INSERT INTO scans (user_id,barcode,product_name,scanned_at) VALUES (?,?,?,NOW())', [req.user.id, barcode, productName]);
    const [saved] = await db.execute(`SELECT DATE_FORMAT(scanned_at,'%Y-%m-%d %H:%i:%s') AS scanned_at FROM scans WHERE id=?`, [result.insertId]);
    await refreshExcel();
    res.status(201).json({ id: result.insertId, barcode, productName, worker: req.user.name, scannedAt: saved[0].scanned_at });
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo guardar el escaneo.' }); }
});

app.get('/api/scans', auth, admin, async (req, res) => {
  try {
    const [rows] = await db.execute(`SELECT s.id, DATE_FORMAT(s.scanned_at,'%Y-%m-%d %H:%i:%s') AS scannedAt,
      u.full_name AS worker, s.barcode, s.product_name AS productName
      FROM scans s JOIN users u ON u.id=s.user_id ORDER BY s.scanned_at DESC LIMIT 1000`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'No se pudo consultar el historial.' }); }
});

app.get('/api/users', auth, admin, async (_req, res) => {
  const [rows] = await db.execute('SELECT id,username,full_name AS fullName,role,active FROM users ORDER BY full_name');
  res.json(rows);
});
app.post('/api/users', auth, admin, async (req, res) => {
  try {
    const { username, password, fullName, role = 'worker' } = req.body;
    if (!username || !password || !fullName) return res.status(400).json({ error: 'Completá usuario, contraseña y nombre.' });
    if (!['admin','worker'].includes(role)) return res.status(400).json({ error: 'Rol inválido.' });
    const hash = await bcrypt.hash(password, 12);
    await db.execute('INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,?)', [username, hash, fullName, role]);
    res.status(201).json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.code === 'ER_DUP_ENTRY' ? 'Ese usuario ya existe.' : 'No se pudo crear el usuario.' }); }
});
app.post('/api/products', auth, admin, async (req, res) => {
  try {
    const { barcode, name } = req.body;
    if (!barcode || !name) return res.status(400).json({ error: 'Completá código y nombre del producto.' });
    await db.execute('INSERT INTO products (barcode,name) VALUES (?,?) ON DUPLICATE KEY UPDATE name=VALUES(name)', [String(barcode).trim(), name.trim()]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'No se pudo guardar el producto.' }); }
});
app.get('/api/export', auth, admin, async (_req, res) => {
  try {
    await refreshExcel();
    res.download(excelPath, 'Control_de_Armado.xlsx');
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo generar el Excel.' }); }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Control de Armado escuchando en http://0.0.0.0:${PORT}`));
