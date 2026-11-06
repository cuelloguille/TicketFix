# Control de Armado

Aplicación inicial para registrar escaneos de productos con lector USB, identificar al trabajador por usuario/contraseña y exportar un único Excel con una hoja por día.

## Requisitos
- Windows 10
- Node.js y npm
- MySQL en la PC principal

## 1. Base de datos
En MySQL Workbench o consola MySQL, ejecutar `database.sql`.

## 2. Backend
Abrir PowerShell en `backend` y ejecutar:

```powershell
npm install
Copy-Item .env.example .env
```
Editar `.env` con los datos de MySQL. Luego:

```powershell
npm run seed
npm run dev
```

Servidor: http://localhost:4000
Usuario administrador inicial: `admin` / `Cambiar123!`

## 3. Frontend
En otra ventana de PowerShell, abrir `frontend` y ejecutar:

```powershell
npm install
npm run dev -- --host 0.0.0.0
```
Abrir http://localhost:5173

Para acceder desde las otras PCs, usar la IP local de la PC principal, por ejemplo `http://192.168.1.50:5173`.

## Importante
- Cambiar la contraseña inicial del administrador.
- Permitir Node.js en el Firewall de Windows para la red privada.
- Este es un prototipo funcional inicial. Antes de uso productivo hay que configurar copias de seguridad y ejecutar servicios al iniciar Windows.
- El lector USB normalmente funciona como teclado: al escanear escribe el código en el campo enfocado y suele enviar Enter. Si el lector no envía Enter, se puede activar el registro con un botón.
