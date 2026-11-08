# MipyPOS para Windows

MipyPOS para Windows es la misma aplicación del APK (ventas, caja, inventario, reportes, módulos empresariales, ONAT y licencias), ejecutada en una ventana de escritorio. Además puede actuar como **servidor de la red local**: la computadora guarda la base de datos principal y los teléfonos Android trabajan como terminales (clientes).

## Requisitos

- Windows 10 u 11 de 64 bits.
- La computadora y los teléfonos conectados al mismo router o Wi-Fi del negocio. No hace falta Internet.
- Una dirección IP privada (192.168.x.x, 10.x.x.x o 172.16–31.x.x). Conviene reservarla en el router para que no cambie.

## Instalación

1. Descarga `MipyPOS-Setup-1.0.0.exe` del pre-release `desktop-<commit>` del repositorio.
2. Ábrelo. Windows SmartScreen puede avisar porque el instalador aún no está firmado con un certificado de editor: pulsa **Más información → Ejecutar de todas formas**.
3. El instalador pide permisos de administrador porque instala para todos los usuarios y crea dos reglas del Firewall de Windows (solo para redes **privadas** y de dominio):
   - `MipyPOS servidor local`: TCP 8787 de entrada (servidor seguro para los teléfonos).
   - `MipyPOS descubrimiento`: UDP 5353 de entrada (anuncio mDNS `_mipypos._tcp`).
4. Si Windows marcó la red Wi-Fi como **Pública**, cámbiala a **Privada** (Configuración → Red e Internet → Wi-Fi → la red → Tipo de perfil de red). En redes públicas el firewall bloquea a los teléfonos.

Al desinstalar se eliminan las reglas del firewall. Los datos del negocio se conservan en el perfil de Windows del usuario (`%APPDATA%\MipyPOS`) y las copias en `Documentos\MipyPOS\Copias`.

## Primer uso

1. Entra con `admin` / `admin123`; la app obliga a crear una contraseña propia.
2. Activa la licencia en Más → Configuración → Licencia. El **código del dispositivo** de la computadora se calcula a partir del identificador de Windows (`MachineGuid`, nunca se envía en claro) y sirve para licencias atadas al equipo, igual que en los teléfonos (ver [LICENCIAS.md](LICENCIAS.md)).
3. Si ya usabas MipyPOS en un teléfono, pásalo a la computadora: en el teléfono, Más → Exportaciones → **Guardar y enviar cierre completo**; copia el `.json` a la computadora y en MipyPOS para Windows usa Más → Exportaciones → **Recibir archivo de cierre** (la computadora debe estar sin productos ni turnos).

## Computadora como servidor y teléfonos como clientes

1. En la computadora: Más → Configuración → Red local → **Iniciar servidor para los teléfonos**. Aparece la dirección `https://<IP>:8787` y un QR.
2. En cada teléfono: Más → Configuración → Red local → **Escanear QR** y apunta al QR de la pantalla.
3. Cada vendedor inicia sesión en su teléfono con su usuario (creado en la computadora, Más → Usuarios).

El servidor se vuelve a iniciar solo al abrir MipyPOS para Windows con un administrador. Si la IP de la computadora cambia, pulsa **Actualizar QR del servidor**; los teléfonos reconocen al mismo administrador por su huella criptográfica y se reconectan con **Buscar mi administrador en Wi-Fi** sin volver a escanear.

La conexión es HTTPS (TLS 1.2) con certificado fijado: el QR contiene la huella SHA-256 de la clave pública de la computadora y los teléfonos rechazan cualquier otro servidor. La clave privada se guarda cifrada con DPAPI de Windows.

## Si se corta la conexión: los teléfonos siguen vendiendo

Cuando un teléfono no alcanza a la computadora (Wi-Fi caído, computadora apagada o reiniciándose):

- **Ventas**: la venta se guarda cifrada en el teléfono con un número provisional `T-1`, `T-2`… y se puede entregar un ticket provisional. Al volver la red se envía sola, en el mismo orden, cada pocos segundos o con **Sincronizar ahora**.
- **Catálogo**: el teléfono usa la última lista de productos, precios y existencias que recibió (se indica la fecha). Descuenta localmente lo vendido sin conexión para no vender de más, pero no ve lo que venden otras terminales mientras dura el corte.
- **Inicio de sesión**: un usuario que ya entró en ese teléfono con conexión puede volver a entrar sin conexión durante **7 días** (se guarda un verificador cifrado, no la contraseña).
- **Sesión renovada**: al volver la red el teléfono renueva su sesión con el servidor sin pedir de nuevo la contraseña (la recuerda solo en memoria mientras la app está abierta).
- **Límite**: hasta **300 ventas** pendientes por teléfono.
- **Requieren conexión**: ventas a crédito, cobros en divisa, ajustes de venta, extracciones, compras, conteos y el resto de operaciones administrativas.

Garantías:

- Cada venta lleva un identificador único; si la confirmación se pierde, el reintento consulta primero si ya se registró, así que **nunca se duplica**.
- Si el servidor **rechaza** una venta (por ejemplo, la caja de ese turno ya se cerró o no hay existencias), aparece en rojo en Ventas. Si el servidor confirma que no la registró, puedes **Reintentar en la caja actual** o **Descartar** (si cobraste, devuelve el dinero o regístrala de nuevo).
- Las ventas pendientes impiden emparejar el teléfono con otro administrador hasta enviarlas.
- **No cierres la caja en la computadora mientras algún teléfono tenga ventas sin enviar**; si lo haces, esas ventas serán rechazadas y deberás reintentarlas en la caja siguiente.

## Impresión y copias

- **Tickets y reportes**: se abren en el diálogo de impresión de Windows; sirve cualquier impresora instalada (térmica USB de 80 mm, láser o “Microsoft Print to PDF”). La impresora Bluetooth ESC/POS sigue siendo exclusiva de Android.
- **Copia automática**: después de cada cierre de caja se guarda un archivo de cierre completo en `Documentos\MipyPOS\Copias`. Más → Exportaciones → **Guardar copia del cierre** crea otra al momento y abre la carpeta. Copia esa carpeta a una memoria USB o a la nube con regularidad.
- La “copia privada” interna de Android no existe en Windows; la sustituyen las copias de la carpeta Documentos.

## Para desarrolladores

| Archivo                                 | Función                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `desktop/main.cjs`                      | Proceso principal Electron: protocolo `app://mipypos` con COOP/COEP (SQLite web con OPFS), IPC, secretos DPAPI, copias    |
| `desktop/lan-server.cjs`                | Servidor HTTPS compatible con `MipyTlsModule.java` (puerto 8787, 1 MB, 32 esperas, 20 s) y cliente con certificado fijado |
| `desktop/lan-identity.cjs`              | Certificado autofirmado EC P-256 con SAN de IP, mismo formato DER que `LanIdentity.java`; pin = base64(SHA-256(SPKI))     |
| `desktop/preload.cjs`                   | Expone `window.mipyDesktop` (contexto aislado, sin Node en la página)                                                     |
| `lib/desktop.ts`                        | Contrato `DesktopBridge` y `supportsSecureLan()` (Android o escritorio)                                                   |
| `lib/network/sale-outbox.ts`            | Cola cifrada de ventas sin conexión                                                                                       |
| `lib/network/offline-session.ts`        | Verificador PBKDF2 para entrar sin conexión (7 días)                                                                      |
| `lib/desktop-backup.ts`                 | Copias en `Documentos\MipyPOS\Copias` y lectura de archivos de cierre                                                     |
| `.github/workflows/desktop-windows.yml` | Exporta la web en Linux y genera el instalador NSIS en Windows; publica el pre-release `desktop-<commit>`                 |

Desarrollo local:

```sh
CI=1 npx expo export -p web     # genera dist/
cd desktop && npm ci
npm start                        # abre la ventana con dist/
npm test                         # pruebas del servidor LAN (MIPY_TEST_IP=<ip privada> para la prueba de ida y vuelta)
npm run dist:win                 # instalador NSIS (en Windows)
```

En desarrollo (`npm start`), la variable `MIPY_LAN_IP` permite forzar la IP del servidor; en la app instalada se ignora.
