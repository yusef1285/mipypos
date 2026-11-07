# Licencias de MipyPOS

MipyPOS funciona sin internet, así que la licencia se verifica **en el teléfono**, con una firma digital. Quien emite las licencias tiene una **clave privada** (nunca va en la app ni en este repositorio). La app trae solo la **clave pública**: con ella puede comprobar que una licencia es auténtica, pero no puede crear licencias nuevas.

- Algoritmo: Ed25519 (firma de 64 bytes, clave de 32 bytes).
- Sin licencia, o con la licencia vencida, la app queda en modo demo: 5 productos y 5 ventas.
- Con una licencia activa, el modo Pro no tiene límites hasta la fecha de vencimiento.

## Planes

| Plan      | Duración          | Uso típico           |
| --------- | ----------------- | -------------------- |
| `trial`   | 7 días            | Prueba de una semana |
| `monthly` | 30 días           | Pago mensual         |
| `annual`  | 365 días          | Pago anual           |
| `custom`  | `--days` (1-3660) | Casos especiales     |

## Formato del texto de licencia

```
MIPY1.<payload>.<firma>
```

- `MIPY1` es la versión del formato.
- `<payload>` es el JSON de la licencia codificado en base64url, sin relleno `=`. El JSON se escribe en ASCII: los caracteres no ASCII van escapados como `\uXXXX`.
- `<firma>` es la firma Ed25519 en base64url de los bytes UTF-8 del texto `MIPY1.<payload>`, es decir, de todo lo que va antes del último punto.

JSON del payload (no admite campos adicionales):

```json
{
  "v": 1,
  "kid": "5eb91449",
  "id": "8d0c1f0e-6a51-4c3c-9d0f-3f1d2b8e4a10",
  "plan": "monthly",
  "customer": "Tienda Ana",
  "device": "ABCD-1234-EF56-7890",
  "iat": "2026-11-07T20:50:43.146Z",
  "exp": "2026-12-07T20:50:43.146Z"
}
```

| Campo      | Obligatorio | Descripción                                                                                         |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `v`        | sí          | Siempre `1`.                                                                                        |
| `kid`      | sí          | Id de la clave que firmó: los primeros 8 caracteres hex del SHA-256 de la clave pública (32 bytes). |
| `id`       | sí          | UUID único de la licencia, para tu registro.                                                        |
| `plan`     | sí          | `trial`, `monthly`, `annual` o `custom`.                                                            |
| `customer` | sí          | Nombre del cliente (puede ir vacío, máximo 120 caracteres).                                         |
| `device`   | no          | Código del dispositivo. Si falta, la licencia sirve en cualquier teléfono.                          |
| `iat`      | sí          | Inicio de la validez, en ISO 8601 UTC.                                                              |
| `exp`      | sí          | Vencimiento, en ISO 8601 UTC. Debe ser posterior a `iat`.                                           |

La app ignora los espacios y saltos de línea al pegar la licencia, así que se puede enviar por WhatsApp aunque se corte en varias líneas.

## Código de dispositivo

En **Configuración → Licencia** la app muestra un código con la forma `XXXX-XXXX-XXXX-XXXX`, que el cliente puede copiar. Se calcula así:

```
código = primeros 16 hex (mayúsculas) de SHA-256("MIPYPOS-DEVICE-V1:" + ANDROID_ID), en grupos de 4
```

El ANDROID_ID es fijo para cada combinación de teléfono y firma de la app. Cambia si se restablece el teléfono de fábrica o si se instala una APK firmada con otra clave. En esos casos el cliente necesita una licencia nueva.

Recomendación: emite las licencias de pago **atadas al dispositivo** (`--device`). Una licencia sin dispositivo, como las de prueba, se puede usar en varios teléfonos hasta que venza.

## Cómo la verifica la app

`lib/license-token.ts` (`evaluateLicense`) lo comprueba en este orden:

1. El prefijo `MIPY1`, la estructura con tres partes y que el JSON sea válido.
2. Que el `kid` exista en `lib/license-keys.ts` y que la firma sea válida para esa clave.
3. Si la licencia trae `device`, que coincida con el código del teléfono.
4. **Protección contra atrasar el reloj**: la app guarda la fecha más reciente que ha visto (`license_last_seen`). Si la fecha actual queda más de 1 día por detrás de esa fecha, o por detrás de `iat`, la licencia pasa al estado "reloj atrasado" y no da acceso Pro.
5. Que no haya vencido, comparando con la mayor de las dos fechas: la actual y la última vista.

Resultados posibles: `none` (sin licencia), `invalid`, `clock`, `expired` o `active`. Cuando faltan 7 días o menos, el estado activo se marca como "por vencer" y el administrador ve un aviso en todas las pantallas.

La app vuelve a verificar la licencia al abrirse, cada 60 segundos y cada vez que vuelve al primer plano. Además, la base de datos guarda la fecha de vencimiento (`license_expires_at`), así que los límites del modo demo vuelven aunque nadie refresque la pantalla. En los teléfonos que funcionan como cliente LAN, la licencia la valida el servidor.

## Generador incluido (Windows, Linux o Mac)

Está en `tools/licencias/`. Solo necesita [Node.js 18 o superior](https://nodejs.org), sin dependencias adicionales. Las instrucciones paso a paso están en `tools/licencias/LEEME.md`.

```bat
REM Interactivo: pregunta el plan, el dispositivo y el cliente
generar-licencia.bat

REM Directo
generar-licencia.bat --plan monthly --device ABCD-1234-EF56-7890 --customer "Tienda Ana"
generar-licencia.bat --plan custom --days 90 --customer "Cafetería Luis" --out licencia.txt
```

Opciones de `generar-licencia.mjs`:

| Opción       | Descripción                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------- |
| `--plan`     | `trial` (por defecto), `monthly`, `annual` o `custom`.                                      |
| `--days`     | Días de validez. Es obligatorio con `custom` y sustituye la duración del plan en los demás. |
| `--device`   | Código del dispositivo del cliente.                                                         |
| `--customer` | Nombre del cliente.                                                                         |
| `--key`      | Ruta de la clave privada. Por defecto, `mipypos-licencias-privada.pem` en la misma carpeta. |
| `--start`    | Fecha de inicio `AAAA-MM-DD`. Por defecto, ahora.                                           |
| `--out`      | Guarda la licencia y su resumen en un archivo.                                              |

Cada licencia emitida se anota en `licencias-emitidas.csv`, en la carpeta de la clave privada.

## Crear una app externa propia

Cualquier lenguaje con Ed25519 sirve: Python (`cryptography`), C# (.NET 8 o la librería NSec), Go (`crypto/ed25519`), PHP (`sodium_crypto_sign_detached`) o Java 15 o superior. Estos son los pasos:

1. Carga la clave privada Ed25519. El archivo `.pem` está en formato PKCS#8; si tu librería pide la semilla de 32 bytes, son los últimos 32 bytes del DER.
2. Calcula `kid` = los primeros 8 hex del SHA-256 de la clave **pública** en bruto (32 bytes).
3. Arma el JSON con los campos de la tabla anterior, en ASCII. El orden de los campos no importa, porque se firma el texto ya codificado.
4. `payload = base64url(json)` sin `=`.
5. `cuerpo = "MIPY1." + payload`.
6. `firma = base64url(Ed25519_sign(privada, utf8(cuerpo)))` sin `=`.
7. `licencia = cuerpo + "." + firma`.

Ejemplo en Python:

```python
import base64, hashlib, json, uuid, datetime as dt
from cryptography.hazmat.primitives import serialization

b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
key = serialization.load_pem_private_key(open("mipypos-licencias-privada.pem", "rb").read(), None)
raw_pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
now = dt.datetime.now(dt.timezone.utc)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%S.000Z")
payload = {
    "v": 1, "kid": hashlib.sha256(raw_pub).hexdigest()[:8], "id": str(uuid.uuid4()),
    "plan": "annual", "customer": "Tienda Ana", "device": "ABCD-1234-EF56-7890",
    "iat": iso(now), "exp": iso(now + dt.timedelta(days=365)),
}
body = "MIPY1." + b64(json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode())
print(body + "." + b64(key.sign(body.encode())))
```

Para comprobar una licencia generada por tu app externa, pégala en la app. También puedes verificarla con `evaluateLicense` desde una prueba (ver `scripts/license-regression.test.ts`).

## Rotar o cambiar la clave

1. Ejecuta `crear-claves.bat` (o `node crear-claves.mjs nueva.pem`). Nunca sobrescribe una clave existente.
2. Agrega la línea que imprime (`'kid': 'clave-publica'`) a `lib/license-keys.ts`, compila y distribuye la nueva APK.
3. Deja la clave anterior en la lista mientras haya licencias suyas vigentes. Si la clave privada se filtró, quítala de inmediato: todas sus licencias dejarán de valer al actualizar la app.

## Seguridad

- La clave privada nunca se sube al repositorio: `tools/licencias/.gitignore` excluye `*.pem`, el CSV y los textos de licencia, y una prueba falla si aparece alguna clave privada versionada.
- Guarda copias de la clave privada en dos lugares seguros, por ejemplo un USB cifrado y un gestor de contraseñas. Si la pierdes, no podrás emitir licencias para esa clave y tendrás que rotarla.
- La verificación es local, así que un atacante con acceso root podría modificar la APK. Para el público objetivo, la firma, el código de dispositivo y la protección del reloj son suficientes.
