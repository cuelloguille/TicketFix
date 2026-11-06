require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
(async () => {
  try {
    const [rows] = await db.execute('SELECT id FROM users WHERE username = ?', ['admin']);
    if (!rows.length) {
      const hash = await bcrypt.hash('Cambiar123!', 12);
      await db.execute('INSERT INTO users (username,password_hash,full_name,role) VALUES (?,?,?,?)', ['admin', hash, 'Administrador', 'admin']);
      console.log('Administrador creado: admin / Cambiar123! Cambie esta contraseña después del primer ingreso.');
    } else console.log('El usuario admin ya existe.');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { await db.end(); }
})();
