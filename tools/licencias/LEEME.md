# Generador de licencias MipyPOS

Requisito: Node.js 18 o superior (https://nodejs.org). No hace falta instalar nada más.

## Primera vez

1. Copia tu clave privada `mipypos-licencias-privada.pem` en esta misma carpeta.
   - Si no tienes ninguna, ejecuta `crear-claves.bat` y agrega a `lib/license-keys.ts` la línea que imprime. Después recompila la app.
2. Guarda una copia de la clave en un lugar seguro y no la compartas con nadie.

## Emitir una licencia

1. Pide al cliente el **código de dispositivo**: en la app, Configuración → Licencia → Copiar código.
2. Haz doble clic en `generar-licencia.bat` y responde:
   - Plan: `trial` (7 días), `monthly` (30 días) o `annual` (365 días).
   - Código de dispositivo. Si lo dejas vacío, la licencia sirve en cualquier teléfono.
   - Nombre del cliente.
3. El generador muestra la licencia, que también queda guardada en `ultima-licencia.txt`. Envíasela al cliente por WhatsApp.
4. El cliente la pega en Configuración → Licencia → Activar.

## Línea de comandos

```
generar-licencia.bat --plan annual --device ABCD-1234-EF56-7890 --customer "Tienda Ana"
node generar-licencia.mjs --plan custom --days 90 --customer "Cliente" --out licencia.txt
node generar-licencia.mjs --plan monthly --start 2026-12-01 --key D:\claves\privada.pem
```

Opciones:

- `--plan trial|monthly|annual|custom`
- `--days N`: obligatorio con `custom`.
- `--device XXXX-XXXX-XXXX-XXXX`
- `--customer "Nombre"`
- `--key ruta.pem`
- `--start AAAA-MM-DD`
- `--out archivo.txt`

Cada licencia se anota en `licencias-emitidas.csv`, junto a la clave privada.

Documentación técnica del formato: `docs/LICENCIAS.md`.
