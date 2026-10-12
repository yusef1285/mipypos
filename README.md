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
