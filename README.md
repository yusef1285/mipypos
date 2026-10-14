# Welcome to your Bilt project

[![Built with Bilt](https://img.shields.io/endpoint?url=https%3A%2F%2Fapp.bilt.me%2Fapi%2Fbadge)](https://bilt.me)

## Project info

**Project URL**: https://app.bilt.me/agent/244cb410-fc55-4a99-ada8-f8c7c13dd54e

**Project ID**: `244cb410-fc55-4a99-ada8-f8c7c13dd54e`

## How can I edit this app?

There are several ways of editing your application.

**Use Bilt**

Simply visit your [Bilt Project](https://app.bilt.me/agent/244cb410-fc55-4a99-ada8-f8c7c13dd54e) and start sending messages. Describe what you want to change, add, or fix in natural language.

Changes made via Bilt are instant - just send a message and your app updates.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can export the source code from Bilt and make changes directly.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Export and clone your Bilt project.
# (Download source from Bilt or connect to your git repo)
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm install

# Step 4: Start the Expo development server.
npx expo start
```

Scan the QR code with Expo Go on your phone to see your app running locally.

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- React Native
- Expo
- TypeScript
- AsyncStorage (local data persistence)
- Expo Router (navigation)

All generated automatically by Bilt from your natural language instructions.

## How can I test this project?

**Option 1: Preview in Bilt (Recommended)**

Open your [Bilt Project](https://app.bilt.me/agent/244cb410-fc55-4a99-ada8-f8c7c13dd54e) and use the built-in preview.

Open **Deploy & Share** to create a revocable preview link or build the app on your iPhone.

**Option 2: Run Locally**

```sh
npm install
npx expo start
```

Then scan the QR code with Expo Go.

## How can I deploy this project?

Open your [Bilt Project](https://app.bilt.me/agent/244cb410-fc55-4a99-ada8-f8c7c13dd54e), select **Deploy & Share**, then choose **Publish to web**, **Release on App Store**, or **Release on Play Store**.

### Deploy with Bilt

Publishing to web creates a public, installable web app at its own URL. Bilt also guides you through preparing native releases for the App Store and Play Store.

## How can I make changes to my app?

**Via Bilt (Easiest)**

Visit your [Bilt Project](https://app.bilt.me/agent/244cb410-fc55-4a99-ada8-f8c7c13dd54e) and send a message describing what you want:

- "Add a dark mode toggle"
- "Change the button color to blue"
- "Add a new screen for user settings"
- "Fix the navigation bar spacing"

Bilt understands natural language and updates your app automatically.

**Via Code**

Export the source, make changes in your IDE, and test locally with `npx expo start`.

## Can I use this with the MCP protocol?

Yes! Bilt is available as a remote MCP server at `https://mcp.bilt.me/mcp`.

Connect any MCP-compatible AI agent (Claude Desktop, OpenClaw, etc.) to programmatically build and modify mobile apps.

**Example MCP integration:**

```json
{
  "mcpServers": {
    "bilt": {
      "transport": {
        "type": "sse",
        "url": "https://mcp.bilt.me/mcp/sse",
        "headers": {
          "Authorization": "Bearer YOUR_API_KEY"
        }
      }
    }
  }
}
```

Read more:

- [Bilt MCP Documentation](https://bilt.me/docs)
- [MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.buildingapplications%2Fmcp/versions/latest)

## Need help?

- 📚 [Bilt Documentation](https://bilt.me/docs)
- 💬 [Discord Community](https://discord.gg/3FqNgmSYdZ)
- 🐦 [Twitter Updates](https://twitter.com/biltmeanapp)
- 📧 Email: support@bilt.me

---

<div align="center">

**Built by AI. No code required.** ✨

[Try Bilt](https://bilt.me) • [View Docs](https://bilt.me/docs) • [Docs MCP Server](https://bilt.me/docs/mcp)

</div>

## MipyPOS: red segura y comprobación Android

La red LAN usa HTTPS/TLS 1.2 offline. El QR v4 contiene la dirección local y el pin SHA-256 de la clave pública del administrador; puede incluir credenciales Wi-Fi. Comparte el QR solo con terminales de confianza y escanéalo directamente en el teléfono administrador. No se acepta HTTP, certificados de otro host, certificados vencidos ni redirecciones. La clave privada TLS se genera en Android Keystore y no se exporta. El certificado incluye la IP actual como SAN; actualizar el host renueva el certificado sin cambiar el pin. Reinstalar el host elimina su identidad y exige emparejar de nuevo. Revisa la fecha de ambos teléfonos.

La activación y los hashes de contraseñas existentes no se modificaron. Se añadieron límites de acceso (5 intentos por cuenta y 30 globales por minuto), tokens y confianza en SecureStore, revocación online al salir y reintento diferido si el host está desconectado. Las sesiones inactivas vencen a los 15 minutos; sin comunicación no puede garantizarse revocación inmediata. Los permisos denegados no invalidan una sesión válida.

Las mutaciones generales conservan UUID, usuario, terminal y huella del contenido. SQLite guarda efecto y recibo en la misma transacción. Ante una respuesta perdida, el cliente consulta el recibo antes de repetir; al iniciar sesión con el mismo usuario recupera la operación pendiente. Ventas y extracciones conservan sus mecanismos específicos. No cambies de host ni borres datos con operaciones pendientes. Tras actualizar una versión HTTP, escanea el QR seguro del mismo host/IP: los pendientes conservan sus UUID; no se transmiten por HTTP.

### Compilación y límites de verificación

- La LAN segura y el hotspot necesitan una **nueva compilación Android**, no Expo Go ni preview web/iOS. Los demás módulos locales no cambian de plataforma.
- El plugin `lib/network/withLocalHotspot.ts` registra los módulos y añade NanoHTTPD 2.3.1 a Gradle. No se utiliza el antiguo bridge HTTP.
- Con el código y un SDK Android local: `npm install`, `npx expo run:android --variant release`. La primera compilación necesita descargar dependencias; el APK opera sin internet. No cambies los identificadores de publicación administrados en `app.config.ts`.
- Mantén el administrador en primer plano durante estas pruebas. No se ha validado un servicio Android en segundo plano.
- `npm run validate:pos` ejecuta regresiones SQLite y host/client con transporte simulado. No comprueba handshake TLS, Keystore, compilación Java, cámara, ni hotspot real. `npx expo-doctor` y `npx expo install --check` tampoco sustituyen la prueba física.

### Checklist de aceptación en dos Android

Registrar por caso: modelo y Android de A/B, versión del APK, pasos, resultado esperado/observado, capturas o logs sin contraseñas, aprobado/fallido. No usar datos de producción. Usar una licencia ya disponible para ciclos largos; la demo conserva sus cuotas y no se debe modificar para probar.

1. A administrador, B vendedor: cambiar la contraseña inicial de A, crear un vendedor y dos áreas. Preparar arroz kg (10.000 a 100 CUP/kg) y producto u (1 a 50 CUP). Abrir caja con 100 CUP. Desactivar datos móviles e internet en ambos.
2. Crear hotspot en A, escanear QR v4 en B, aceptar el permiso de Wi-Fi/cámara y entrar con usuario de A. Android 10+ conecta Wi-Fi por QR; en Android 8/9 conectar desde Ajustes antes de escanear. Deben verse caja, áreas y stock de A.
3. Rechazar QR HTTP, versión antigua, pin alterado y dirección externa. Con una herramienta de prueba TLS, presentar un certificado de otro host, vencido o con IP SAN incorrecta: ningún login ni operación debe llegar al host. **Pendiente de ejecutar físicamente**, no demostrado por las pruebas simuladas.
4. Vender 1.003 kg en A y 2.323 kg en B simultáneamente desde el mismo área. Deben existir dos ventas y stock 6.674 kg, sin negativos. Competir por la última unidad del otro producto: solo una venta aprobada.
5. Trasladar 1 kg entre áreas: origen -1, destino +1 y total sin cambio. Vender en destino: solo se descuenta ese área. Renombrar/cambiar precio de un producto desde A: B debe recibir la actualización; carrito obsoleto debe bloquear lo incompatible, no guardar nombre/unidad antiguos.
6. Apagar Wi-Fi de B antes de enviar, después de enviar y después del commit antes de recibir la respuesta. Reconectar escaneando QR y reintentar con el mismo UUID: cero o una operación, nunca dos. Repetir ventas, extracciones, entradas/traslados, altas/importación, apertura y cierre de caja. Para pérdida exacta de respuesta usar un build de prueba/proxy controlado, no desactivar TLS.
7. Repetir con cierre forzado de B y reinicio del host sin borrar datos. Reentrar con el mismo usuario. Las mutaciones generales pendientes deben recuperar el recibo durable; ventas/extracciones se confirman desde sus flujos. Deben conservarse ventas y stock incluso con caja ya cerrada.
8. Perder hotspot, cancelar solicitud Android, reconectar, alternar entre red creada por A y Wi-Fi compartido, repetir tres ciclos. No deben quedar callbacks antiguos ni tráfico dirigido a datos móviles. Si cambia IP, actualizar QR de A y volver a vincular: después de verificar el mismo pin se conserva el UUID de los pendientes y se actualiza únicamente su dirección. Los pendientes HTTP antiguos, que no tenían pin, solo se migran al mismo host/IP.
9. Salir online de B y reutilizar su token en una herramienta de prueba: AUTH_EXPIRED. Salir offline y reconectar: revocación diferida en el siguiente login o expiración por inactividad; el teléfono no debe conservar token activo local. Probar límite de intentos y recuperar tras un minuto. Nunca registrar tokens en evidencias.
10. Caja: extracción real 20 CUP, motivo "Entrega al proveedor", administrador autorizador. Intentar comprobar 10 CUP: debe requerir autorización y motivo sin cambiar el retiro real de 20. Confirmar efectivo esperado según fondo + ventas efectivo - 20, transferencia exacta y stock de productos vendidos.
11. Probar contraseña/admin inválido, motivo vacío, diferencia de efectivo/transferencia/inventario y conteos modificados después de autorizar: bloqueo hasta autorización válida del estado actual. Cerrar con diferencias autorizadas y revisar importes, motivos, fecha y autorizador en historial tras reiniciar.
12. Exportar CSV/XLSX/TXT de caja: detalle del cierre, autorizaciones y retiros reales deben coincidir con historial. Nombre `=1+1` debe ser texto al abrir CSV, no fórmula. Verificar tickets PDF, compartir/abrir archivos, roles, altas/ediciones/borrado, importación, reportes, demo, teclado y navegación en ambos dispositivos.

No declarar la LAN/hotspot resueltos en dispositivos ni toda la app libre de errores hasta aprobar estos casos con evidencias. Una compilación o un pin fallido debe bloquear el tráfico, nunca recurrir a HTTP.

## Cobro, comprobantes, traslado y auditoría

- Efectivo: registrar lo recibido y comprobar vuelto; caja contabiliza solo la parte aplicada a la venta, no el billete entregado. En mixto el vuelto se calcula únicamente contra la parte en efectivo.
- Transferencia/mixto: CI de 11 dígitos, nombre y dirección antes de captar foto o imagen. OCR ML Kit latino **incluido en el APK** (`com.google.mlkit:text-recognition:16.0.1`), sin descarga de modelo en el primer uso. Revisar texto, importe, referencia y fecha. El importe leído se incorpora al cobro y debe coincidir con la parte transferida; la foto nunca confirma el abono bancario. La foto comprimida se guarda en galería del teléfono capturador y dentro del registro de venta en el host; no se envía a un servicio externo. Sin APK Android adecuado se informa del módulo ausente. La imagen se limita a 600000 caracteres base64 para respetar el transporte TLS de 1 MiB. Se bloquea reutilizar la misma imagen o referencia; no es un detector de comprobantes falsificados.
- Cierre completo: administrador, caja cerrada, sin pendientes y modo independiente en origen/destino. Exportaciones permite guardar/compartir JSON versionado con checksum SHA-256, todos los registros del negocio, usuarios y hashes existentes sin reescribirlos, secuencias, cuotas acumuladas e imágenes. No se copia licencia, identidad TLS, tokens ni configuración de red. Importación solo en destino sin productos/ventas/movimientos/turnos; valida columnas, referencias, stock y sumas, y revierte si falla. Propone el efectivo físico del último cierre como fondo de apertura; no abre caja automáticamente. El checksum detecta daños, **no autentica al remitente ni cifra el archivo**. El JSON y la galería contienen información personal: compartir únicamente por un canal de confianza y controlar copias/acceso. Límite de recepción 150 MB. Tras exportar, no continuar vendiendo en el origen ni operar ambos como negocios separados: el archivo es un traspaso, no sincronización entre hosts.
- Usuarios: crear cuenta con rol `auditor` y contraseña propia; no se crea una contraseña universal. El auditor entra en otro teléfono por QR y abre Más → Auditoría. Consulta ventas con detalle/comprobante, movimientos, existencias por área y cierres; actualiza cada 5 s. No puede vender, retirar efectivo, modificar usuarios/productos/inventario ni abrir/cerrar caja. El host verifica permisos en cada operación. Mantener el vendedor en primer plano.
- Wi-Fi Direct: Android propietario en teléfono vendedor, `WifiP2pManager` real, descubrimiento y unión al propietario del QR, TLS/pin y credenciales de usuario conservados. Permitir dispositivos cercanos (Android 13+) o ubicación (Android 12 y anteriores); activar Wi-Fi y ubicación para descubrimiento. Aceptar solicitud Android. Hotspot sigue siendo una opción separada, no un sustituto silencioso de P2P. Cambio de grupo o reinicio requiere regenerar y escanear QR. No funciona en Expo Go, web ni iOS.

### Pruebas adicionales en dos Android — pendientes de ejecución

1. Nueva compilación instalada en A/B. Sin internet ni datos móviles desde antes del primer arranque: leer comprobante nítido y borroso, permisos cámara/galería denegados y cancelación. Comprobar imagen en galería y datos conservados tras reiniciar A y B. Adjuntar los ejemplos reales de mensajes para ajustar la extracción: todavía no se recibieron.
2. Venta 100 CUP, recibido 150 → vuelto 50, caja +100. Recibido 99 o vacío → rechazo sin descontar stock. Mixto 40 efectivo +60 transferencia, recibido 50 → vuelto 10; transferido distinto de 60 → rechazo. Comprobante sin datos/revisión → rechazo. Repetir referencia/imagen → rechazo, pero reintentar el mismo UUID tras desconexión → una venta.
3. A crear Wi-Fi Direct y QR; B escanear, aceptar emparejamiento y entrar como vendedor. Probar ventas simultáneas del caso 4 anterior, pérdida de red antes/después del commit, cancelación de Android, timeout, reconexión tres veces y cambio de IP/QR con pin persistente. Verificar que no hay tráfico HTTP ni a datos móviles.
4. A seguir vendiendo; B iniciar sesión como auditor. Revisar ventas, recibidos/vueltos, comprobantes, entradas/traslados, stock y cierres; intentar todas las mutaciones desde UI y solicitudes de prueba → denegadas. Consultar mientras A confirma una venta: totales/stock coherentes y sin cerrar la caja.
5. Cerrar A con extracción real y diferencias autorizadas; desconectar terminales, modo independiente, enviar JSON. En B independiente y vacío importar, entrar con usuarios recibidos, revisar historia, autorizadores, importes, cuotas, stock por área e imágenes. Licencia B no cambia. Fondo siguiente coincide con efectivo físico de A. Archivo incompleto, versión ajena, segundo import o destino con datos → rechazo sin cambios. No continuar operaciones en A.

Las pruebas automatizadas de Java son guardas estáticas; no prueban compilación, OCR, guardado MediaStore, discovery P2P, handshake ni radio Wi-Fi. Registrar modelos/Android, versión APK, esperado/observado y evidencias antes de declarar aprobado cada caso.
