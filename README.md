# MipyPOS 1.0

Punto de venta **sin Internet** para Android y Windows, pensado para mipymes y TCP en Cuba. Incluye:

- ventas en efectivo, transferencia o mixtas;
- caja con arqueo e inventario por áreas;
- red local cifrada entre teléfonos y computadora, con ventas que siguen funcionando cuando se corta la red;
- módulos empresariales: sucursales, transferencias, clientes y proveedores, monedas, nómina, socios y consolidado;
- ayuda fiscal ONAT;
- licencias firmadas que se verifican sin conexión.

## Descargas

Cada push a `main`, `version-1-0` o `escritorio-windows` publica pre-releases en [Releases](https://github.com/yusef1285/mipypos/releases):

| Plataforma | Pre-release        | Archivo                      |
| ---------- | ------------------ | ---------------------------- |
| Android    | `apk-<commit>`     | `MipyPOS-1.0.0-<commit>.apk` |
| Windows    | `desktop-<commit>` | `MipyPOS-Setup-1.0.0.exe`    |

El APK se firma con la clave de producción del proyecto. El instalador de Windows aún no lleva firma de editor, así que SmartScreen pedirá confirmación (**Más información → Ejecutar de todas formas**).

## Documentación

| Documento                                              | Para quién                   | Contenido                                                            |
| ------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------- |
| [docs/MANUAL-USUARIO.md](docs/MANUAL-USUARIO.md)       | Dueños, cajeros, almaceneros | Uso diario paso a paso                                               |
| [docs/ESCRITORIO.md](docs/ESCRITORIO.md)               | Dueños e instaladores        | MipyPOS para Windows, servidor local y ventas sin conexión           |
| [docs/LICENCIAS.md](docs/LICENCIAS.md)                 | Quien vende la app           | Formato de licencia cifrada y cómo generarlas (app externa o `.bat`) |
| [tools/licencias/LEEME.md](tools/licencias/LEEME.md)   | Quien vende la app           | Uso de `crear-claves.bat` y `generar-licencia.bat`                   |
| [docs/NOTAS-TECNICAS.md](docs/NOTAS-TECNICAS.md)       | Desarrolladores              | Arquitectura, esquema v11, comandos, red, compilación y firma        |
| [lib/offline-acceptance.md](lib/offline-acceptance.md) | QA                           | Lista de aceptación en dispositivos reales                           |
| [docs/HISTORIAL-TECNICO.md](docs/HISTORIAL-TECNICO.md) | Desarrolladores              | Bitácora de entregas anteriores (v7 a v10)                           |

## Funciones

### Ventas y caja

- Búsqueda por nombre o código de barras, con escáner de cámara.
- Precio mayorista automático a partir de una cantidad mínima.
- Pedidos en espera (mesas).
- Cobro en efectivo, transferencia (lectura del comprobante), mixto, a crédito de cliente o en divisa con vuelto en moneda base.
- Ajustes de venta, consumo interno y extracciones de caja.
- Arqueo por denominaciones, con diferencias autorizadas por el administrador.
- Tickets con numeración por sucursal (`PREFIJO-000001`): PDF, impresora térmica Bluetooth ESC/POS (Android) o cualquier impresora de Windows.

### Inventario

- Productos con unidades, decimales, stock mínimo e imagen.
- Áreas de almacén y movimientos.
- Transferencias entre áreas: en tránsito, recepción parcial, devolución y pérdida.
- Compras a proveedores, a crédito o al contado.
- Conteo físico con ajuste auditado y filtro de productos por reponer.

### Módulos empresariales (menú Más)

Sucursales, clientes y proveedores con libro de crédito, monedas y tasas, nómina, socios, consolidado, rentabilidad, inversión y costos, rendimiento de vendedores, auditoría e historial de caja.

### ONAT

Perfil fiscal, cálculo de tributos, documentos y avisos de vencimiento. Requiere la revisión de un contador antes de usarlo en declaraciones reales.

### Reportes y copias

- Reporte diario en PDF para compartir. Exportaciones CSV y XLSX (modo Pro).
- Copia privada en el teléfono.
- Archivo de cierre completo para trasladar el negocio entre equipos.
- En Windows, copia automática tras cada cierre en `Documentos\MipyPOS\Copias`.

### Seguridad

- Contraseñas con PBKDF2 y cambio obligatorio de la contraseña inicial `admin123`.
- Bloqueo biométrico tras 2 minutos en segundo plano.
- Roles: administrador, supervisor, vendedor, almacenero y auditor.
- Registro de errores anónimo, sin ventas, clientes ni contraseñas.

## Red local y ventas sin conexión

- El **administrador** (un teléfono Android o una computadora con Windows) es el servidor. Los demás teléfonos escanean su QR y trabajan como terminales.
- Basta un router, el Wi-Fi del negocio, la zona Wi-Fi del teléfono administrador o Wi-Fi Direct.
- La conexión es HTTPS con TLS 1.2 y certificado fijado: el QR lleva la huella SHA-256 de la clave pública del servidor, y solo se aceptan IP privadas en el puerto 8787.
- Si se corta la red, la terminal **sigue vendiendo**:
  - guarda la venta cifrada con número provisional `T-n` y permite un ticket provisional (hasta 300 ventas pendientes);
  - usa el último catálogo recibido;
  - deja entrar sin conexión hasta 7 días a los usuarios que ya iniciaron sesión con conexión en ese teléfono;
  - al volver la red, sincroniza en orden y sin duplicar, porque cada venta tiene un identificador único y se consulta su recibo.
- Las ventas rechazadas se pueden reintentar en la caja actual o descartar.
- Las ventas a crédito, los cobros en divisa y las operaciones administrativas necesitan conexión.

Detalles en [docs/ESCRITORIO.md](docs/ESCRITORIO.md).

## Licencias

- Firma Ed25519 verificada en el dispositivo, sin Internet.
- Planes: prueba de 1 semana, 1 mes, 1 año o personalizada. Pueden atarse al código del dispositivo (teléfono o computadora).
- Sin licencia, la app funciona en modo demo: 5 productos y 5 ventas, sin impresión ni XLSX.
- Las licencias se generan con `tools/licencias/generar-licencia.bat` o con una app externa que siga [docs/LICENCIAS.md](docs/LICENCIAS.md).
- La clave privada nunca va en el repositorio.

## Estructura

| Carpeta              | Contenido                                                                               |
| -------------------- | --------------------------------------------------------------------------------------- |
| `app/`               | Pantallas (expo-router)                                                                 |
| `components/`        | Componentes de interfaz                                                                 |
| `lib/`               | Datos (SQLite v11), negocio, finanzas, ONAT, licencias, tickets                         |
| `lib/network/`       | Host y cliente LAN, cola de ventas sin conexión, módulos nativos Android (`native/`)    |
| `desktop/`           | Aplicación de Windows (Electron): servidor HTTPS, mDNS, secretos DPAPI, instalador NSIS |
| `scripts/`           | Pruebas de regresión con arnés sql.js                                                   |
| `tools/licencias/`   | Generador de claves y licencias (`.bat` + Node)                                         |
| `.github/workflows/` | CI, APK Android firmada, instalador Windows                                             |

## Desarrollo

Requiere Node 22 (`.nvmrc`).

```sh
npm ci
npx expo start                 # desarrollo
npm run validate:pos           # todas las pruebas de regresión
npm run lint && npm run format:check && npx tsc --noEmit
```

Formato solo con **oxfmt** (`npm run format`).

Escritorio:

```sh
CI=1 npx expo export -p web    # genera dist/
cd desktop && npm ci && npm start
npm test                       # pruebas del servidor LAN
npm run dist:win               # instalador NSIS (en Windows)
```

## Compilación automática

| Flujo                                   | Cuándo                                                                      | Resultado                                       |
| --------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- |
| `.github/workflows/ci.yml`              | Push a `main` y PR                                                          | Tipos, lint, formato y todas las regresiones    |
| `.github/workflows/android-apk.yml`     | Push a `main`, `version-1-0`, `modulos-empresariales`, `escritorio-windows` | APK release firmada, pre-release `apk-<commit>` |
| `.github/workflows/desktop-windows.yml` | Push a `main`, `version-1-0`, `escritorio-windows`                          | Instalador NSIS, pre-release `desktop-<commit>` |

La firma del APK usa los secretos `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` y `ANDROID_KEY_ALIAS`. El `versionCode` es el número de ejecución + 100.

## Historial de versiones

| Entrega               | Contenido principal                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Mantenimiento         | Expo SDK 58, Node 22, CI, contraseñas PBKDF2, cambio obligatorio de `admin123`, lint a 0 advertencias                       |
| Módulos empresariales | SQLite v10: sucursales, transferencias, clientes y proveedores, monedas, nómina, socios y consolidado                       |
| 1.0                   | SQLite v11, licencias Ed25519, crédito y divisa, compras, conteo físico, código de barras, impresora Bluetooth, APK firmada |
| Windows               | MipyPOS para Windows como servidor local y ventas sin conexión en los teléfonos                                             |
