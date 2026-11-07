# MipyPOS 1.0

Punto de venta offline para Android y Windows pensado para mipymes y TCP en Cuba: ventas en efectivo, transferencia o mixtas, caja con arqueo, inventario por áreas, red local entre teléfonos (sin Internet), módulos empresariales (sucursales, clientes y proveedores, monedas, nómina, socios) y ayuda fiscal ONAT.

## Documentación

| Documento                                              | Para quién                   | Contenido                                                            |
| ------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------- |
| [docs/MANUAL-USUARIO.md](docs/MANUAL-USUARIO.md)       | Dueños, cajeros, almaceneros | Uso diario paso a paso                                               |
| [docs/NOTAS-TECNICAS.md](docs/NOTAS-TECNICAS.md)       | Desarrolladores              | Arquitectura, esquema v11, comandos, red, compilación y firma        |
| [docs/ESCRITORIO.md](docs/ESCRITORIO.md)               | Dueños e instaladores        | MipyPOS para Windows, servidor local y ventas sin conexión           |
| [docs/LICENCIAS.md](docs/LICENCIAS.md)                 | Quien vende la app           | Formato de licencia cifrada y cómo generarlas (app externa o `.bat`) |
| [lib/offline-acceptance.md](lib/offline-acceptance.md) | QA                           | Lista de aceptación en dos Android                                   |
| [docs/HISTORIAL-TECNICO.md](docs/HISTORIAL-TECNICO.md) | Desarrolladores              | Bitácora de entregas anteriores (v7 a v10)                           |

## Novedades de la versión 1.0

- Licencias firmadas Ed25519 (prueba de 1 semana, 1 mes, 1 año o perpetua), opcionalmente atadas al dispositivo, verificadas sin Internet.
- Esquema SQLite **v11**: datos extra de producto (código de barras, stock mínimo, precio mayorista), ventas a crédito y cobros en divisa.
- Ventas: escáner de código de barras, precio mayorista automático por cantidad, cobro a crédito de cliente, cobro en divisa con vuelto en moneda base, pedidos en espera (mesas).
- Compras a proveedores (a crédito o contado), conteo físico con ajuste auditado, filtro de productos por reponer.
- Reporte diario en PDF para compartir, impresora térmica Bluetooth ESC/POS, bloqueo biométrico, registro anónimo de errores, recordatorio de copia fuera del teléfono, primeros pasos.
- APK release firmada con clave propia y `versionCode` automático desde GitHub Actions.

## MipyPOS para Windows

- Aplicación de escritorio (`desktop/`, Electron) con las mismas funciones que el APK.
- Puede ser el **servidor** de la red local: los teléfonos escanean su QR y trabajan como terminales.
- Si se corta la red, los teléfonos **siguen vendiendo**: guardan las ventas cifradas (hasta 300), usan el último catálogo y permiten entrar sin conexión hasta 7 días; al volver la red sincronizan solas sin duplicar.
- Tickets por el diálogo de impresión de Windows y copia automática tras cada cierre en `Documentos\MipyPOS\Copias`.
- El instalador `.exe` se genera en `.github/workflows/desktop-windows.yml` y se publica como pre-release `desktop-<commit>`.

## Desarrollo rápido

```sh
npm ci
npx expo start            # desarrollo
npm run validate:pos      # todas las pruebas (sql.js)
npm run lint && npm run format:check && npx tsc --noEmit
```

El APK se genera en GitHub Actions (`.github/workflows/android-apk.yml`) en cada push a `version-1-0` o `modulos-empresariales` y se publica como pre-release `apk-<commit>`.

El instalador de Windows se genera en `.github/workflows/desktop-windows.yml` (pre-release `desktop-<commit>`). Ver [docs/ESCRITORIO.md](docs/ESCRITORIO.md).
