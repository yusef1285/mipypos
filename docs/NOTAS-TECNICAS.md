# Notas técnicas de MipyPOS 1.0

## Pila

Expo SDK 58, React Native 0.88, expo-router, heroui-native, zod 4, expo-sqlite. Las pruebas usan `tsx --test` con un arnés sql.js (`scripts/pos-test-harness.ts`). Formato solo con **oxfmt** (`npm run format`), lint con oxlint (`npm run lint`, 0 advertencias).

## Capas

| Capa           | Archivos                                                                       | Notas                                                                                                   |
| -------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Datos          | `lib/database.ts`, `lib/business.ts`, `lib/finance.ts`, `lib/onat.ts`          | Toda mutación pasa por la cola `mutationQueue` y transacciones; auditoría en `audit_log`                |
| Esquema        | `lib/database-migrations.ts`, `lib/business-schema.ts`                         | `DATABASE_VERSION = 11`, migraciones aditivas                                                           |
| Contratos      | `lib/business-models.ts`, `lib/finance-models.ts`, `lib/network/validation.ts` | zod para cada entrada y resultado                                                                       |
| Red local      | `lib/network/*`                                                                | Host HTTP/TLS en el teléfono admin; `operations.ts` declara módulo y si es mutación; `host.ts` despacha |
| Repositorio UI | `lib/use-pos-repository.ts`                                                    | Misma API en local y en cliente LAN                                                                     |
| Nativo Android | `lib/network/native/*.java`, plugin `lib/network/withLocalHotspot.ts`          | El plugin copia los `.java` y registra `MipyLanPackage` en `prebuild`                                   |
| Escritorio     | `desktop/*.cjs`, `lib/desktop.ts`                                              | Electron sobre la exportación web; `window.mipyDesktop` sustituye a los módulos nativos (ESCRITORIO.md) |
| Sin conexión   | `lib/network/sale-outbox.ts`, `offline-session.ts`, `client.ts`                | Cola cifrada de ventas, login local 7 días, catálogo `offline:` en `network_replica`                    |

## Esquema v11

Tablas nuevas (`BUSINESS_V11_TABLES`):

- `product_extras(product_id PK, barcode UNIQUE parcial, min_stock, wholesale_price, wholesale_min_qty)`.
- `sale_credits(sale_id, party_id, ledger_id, session_id, amount, username, date)` — solo inserción.
- `sale_fx(sale_id, session_id, currency, amount, rate, base_amount, change_base, username, date)` — solo inserción.

Los respaldos privados de versión 9 y 10 se restauran; la conciliación ignora las tablas que no existían en la versión de la copia. El archivo de traslado comercial usa `schemaVersion 10` e incluye las tablas v11; las versiones anteriores se normalizan con tablas vacías.

## Comandos nuevos

| Comando                                   | Operación de red         | Quién                                                       | Efecto                                                                                                                   |
| ----------------------------------------- | ------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `sale.credit {saleId, partyId, dueDate?}` | `executeSaleCommand`     | Admin, supervisor, vendedor (solo sus ventas, caja abierta) | Cargo en el libro del cliente (respeta límite de crédito) + salida de caja "Venta a crédito" por el efectivo de la venta |
| `sale.fx {saleId, currency, amount}`      | `executeSaleCommand`     | Igual                                                       | Toma la tasa vigente; en el arqueo: −`base_amount` en moneda base, +`amount` en la divisa                                |
| `product.extras`                          | `executeBusinessCommand` | Admin, almacenero                                           | Código de barras único, mínimo, precio mayorista                                                                         |
| `purchase.receive`                        | `executeBusinessCommand` | Admin                                                       | Entrada de stock, costo promedio ponderado, deuda con proveedor o salida de caja                                         |
| `inventory.count`                         | `executeBusinessCommand` | Admin, almacenero                                           | Ajusta solo diferencias, con movimiento y auditoría                                                                      |

Lectura: `getSaleOptions` (moneda base, extras, clientes activos, monedas con tasa) y `listProductExtras`.

Decisiones:

- La venta se registra primero como efectivo (`registerSale` no cambia) y luego se aplica el comando de crédito/divisa. Si el segundo paso falla, la venta queda como efectivo y se avisa al usuario; puede cargarse luego desde Clientes y proveedores.
- Los ajustes de venta (devolución/descuento/anulación) se bloquean para ventas con crédito o divisa, y no se puede anular el cargo del libro de una venta a crédito.
- `lib/sale-pricing.ts` (`lineUnitPrice`) es la única fuente del precio por línea, usada en UI, `registerSale` y el host LAN, así el cliente y el servidor calculan igual. Las promociones se limitan a este precio mayorista por cantidad.

## Datos solo del dispositivo (AsyncStorage)

- `mipypos.held-orders.v1`: pedidos en espera por `clientId:userId`, máximo 30.
- `mipypos.error-log.v1`: últimos 30 errores, mensaje y 5 líneas de pila, con correos y números largos enmascarados.
- `mipypos.last-archive-share.v1`: fecha del último cierre completo compartido.
- `mipypos.bt-printer.v1`: impresora Bluetooth elegida y columnas (32 o 48).

## Licencias

Ver [LICENCIAS.md](LICENCIAS.md). Código: `lib/license-token.ts` (formato y verificación Ed25519), `lib/license-keys.ts` (claves públicas por `kid`), `lib/license.ts` (almacenamiento, reloj y estado), `components/LicensePanel.tsx`. Herramientas para emitir: `tools/licencias/`.

## Impresora Bluetooth

`MipyPrinterModule.java` usa Bluetooth clásico SPP (`00001101-…`) con dispositivos ya emparejados; envía en bloques de 512 bytes. `lib/escpos.ts` es un codificador puro (pruebas en `scripts/escpos.test.ts`) que pliega tildes a ASCII. Permisos: `BLUETOOTH_CONNECT` (Android 12+) y `BLUETOOTH`/`BLUETOOTH_ADMIN` con `maxSdkVersion 30`.

## Seguridad en la app

- `components/AppLock.tsx`: bloqueo tras 2 min en segundo plano con `expo-local-authentication`; cierre de sesión tras 30 min o si el teléfono no tiene bloqueo.
- `lib/error-log.ts`: `ErrorBoundary` nativo en español + manejador global; no se envía nada automáticamente. PostHog solo se inicia en la vista web de vista previa, sin grabación de sesión.

## Compilación y firma del APK

Workflow `.github/workflows/android-apk.yml`:

1. `npm ci`, `expo prebuild --platform android --clean`, `./gradlew assembleRelease` (arm64-v8a y armeabi-v7a).
2. `versionCode = 100 + run_number` (variable `APP_VERSION_CODE`, leída en `app.config.ts`); `versionName` = `package.json`.
3. Firma con `zipalign` + `apksigner` usando los secretos `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD` y `ANDROID_KEY_ALIAS` (keystore PKCS12). Sin secretos firma con la clave debug.
4. Publica una pre-release `apk-<sha7>` con el APK adjunto.

Para cambiar la clave: `keytool -genkeypair -storetype PKCS12 -keystore mipypos-release.p12 -alias mipypos -keyalg RSA -keysize 4096 -validity 10950`, luego `base64 -w0` del archivo en el secreto. Cambiar la clave obliga a desinstalar la app en los teléfonos (se pierden los datos locales si no hay cierre completo exportado).

## Pruebas

`npm run validate:pos` ejecuta POS, seguridad, LAN, finanzas, ONAT, recuperación, empresariales, licencias y ESC/POS. Antes de entregar: `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `node scripts/lint-css.mjs`, `CI=1 npx expo export -p web`.

## Pendiente fuera del código

- Pruebas físicas en dos Android (ver `lib/offline-acceptance.md`) y con impresoras Bluetooth reales.
- Validación por un contador de nómina, ONAT y tratamiento contable de crédito/divisa.

## Ventas sin conexión en terminales

- `registerPosSale` en modo cliente encola siempre la venta en `sale-outbox` (`createPendingStore('mipypos.saleOutbox.v1')`, cifrado) y luego intenta `syncOutbox`. Devuelve `{ saleId }` si el host confirmó o `{ offline: OutboxSale }` si quedó en cola.
- `syncOutbox` envía en orden con `registerHostSale` (consulta `/v1/sale-receipt` antes y después), se detiene ante error de red, marca `rejected` ante `HostRejection` y conserva `notCommitted` solo cuando el host confirma que no registró la venta. `retryOutboxSale` asigna un `commandId` nuevo solo a ventas `notCommitted`.
- El catálogo sin conexión se guarda en `network_replica` con claves `offline:<sha256(autoridad, usuario)>`; `clearNetworkReplicas()` lo conserva y `clearNetworkReplicas(true)` lo borra (cambio de administrador).
- `offline-session.ts` guarda un verificador PBKDF2 por (pin del host, usuario) en almacenamiento seguro; caduca a los 7 días.
- Pruebas: `scripts/lan-security.test.ts` (cola, ACK perdido, rechazos, login y catálogo sin conexión) y `desktop/test/lan.test.cjs` (certificado, pin y servidor HTTPS).
