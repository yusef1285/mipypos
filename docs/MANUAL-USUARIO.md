# Manual de usuario de MipyPOS 1.0

## Primer uso

1. Instala el APK. Si tenías una versión de prueba anterior firmada de otra forma, desinstálala primero.
2. Entra con el usuario `admin` y la contraseña inicial que te indicó el vendedor; la app te pedirá cambiarla.
3. En Inicio aparece la tarjeta **Primeros pasos**: crea usuarios (Más → Usuarios), revisa la moneda base (Más → Monedas y tasas), crea productos y áreas, abre la caja y vende.
4. Activa la licencia en Más → Configuración → Licencia: copia el **código del dispositivo** si tu licencia va atada al teléfono, pega el texto `MIPY1.…` que te enviaron y pulsa Activar.

## Roles

| Rol           | Puede                                                              |
| ------------- | ------------------------------------------------------------------ |
| Administrador | Todo                                                               |
| Supervisor    | Caja, ventas, reportes                                             |
| Vendedor      | Ventas y consumo interno                                           |
| Almacenero    | Inventario, productos, movimientos, transferencias y conteo físico |
| Auditor       | Consultar reportes, auditoría y módulos empresariales              |

## Vender

1. Abre la caja (pestaña Caja) con el fondo inicial.
2. En Ventas elige el área, busca el producto por nombre o código, o pulsa el icono de escáner y apunta al código de barras. Cada lectura suma una unidad.
3. Si el producto tiene **precio mayorista**, se aplica solo al llegar a la cantidad mínima y aparece "precio mayorista" en la línea.
4. Elige el método: efectivo, transferencia o mixto. En efectivo puedes elegir **Cobro especial**:
   - **A crédito**: elige el cliente; la venta se carga a su cuenta en Clientes y proveedores. En la caja aparece la venta y una salida "Venta a crédito" por el mismo importe, así el arqueo cuadra.
   - **En divisa**: elige la moneda (USD, EUR, MLC…) y el importe recibido; la app muestra el equivalente y el vuelto en moneda base. La divisa se cuenta aparte en el arqueo.
5. **Poner en espera**: escribe un nombre (Mesa 3, Juan) y guarda el carrito; aparece arriba como "Pedidos en espera" para retomarlo luego. Se guarda solo en ese teléfono.
6. Tras completar, puedes generar el ticket PDF o **Imprimir** en la impresora Bluetooth (licencia Pro).

Las ventas a crédito o en divisa no admiten ajustes (devolución o descuento) desde Ajustes de venta; corrige con un cargo o pago en la cuenta del cliente.

## Productos e inventario

- En Productos, cada producto tiene código de barras (se puede escanear), **stock mínimo** (aviso de reposición, por defecto 5) y precio mayorista con cantidad mínima.
- El chip **Por reponer** muestra los productos en o bajo su mínimo; Inicio también los resume.
- **Compras a proveedores** (administrador): elige proveedor y área, agrega productos con cantidad y costo, indica la factura y si es a crédito (queda deuda con el proveedor), efectivo (sale de la caja abierta) o transferencia. El stock y el costo promedio se actualizan.
- **Conteo físico** (almacenero o administrador): elige el área, escribe lo contado en cada producto; solo se ajustan los que escribiste y cada diferencia queda en Movimientos y Auditoría.

## Caja y reportes

- Cierra la caja al final del día; el arqueo separa efectivo en moneda base y en divisas.
- En Reportes pulsa **Enviar PDF** para compartir el resumen del día por WhatsApp, Telegram o correo.

## Copias de seguridad

- Más → Configuración → Copia privada: crea una copia dentro del teléfono (útil ante errores, no ante pérdida del teléfono).
- Más → Exportaciones → **Guardar y enviar cierre completo**: genera un archivo con todo el negocio que puedes enviar a otro teléfono o a tu correo. Inicio te recuerda hacerlo si pasan más de 24 horas.

## Red local

Un teléfono administrador actúa como servidor y los demás se conectan escaneando su QR en Configuración → Red local. No hace falta Internet: basta un Wi-Fi o la zona Wi-Fi del teléfono administrador.

También puede ser servidor una computadora con **MipyPOS para Windows** (ver [ESCRITORIO.md](ESCRITORIO.md)).

### Si se corta la conexión

- El teléfono sigue vendiendo: la venta se guarda en el teléfono con un número provisional (T-1, T-2…) y puedes dar un ticket provisional. En Ventas aparece “ventas sin enviar”.
- Al volver la red se envían solas, o pulsa **Sincronizar ahora**. Nunca se duplican.
- Se usa el último catálogo recibido (se muestra la fecha); las existencias pueden no reflejar lo vendido en otras terminales.
- Un usuario que ya entró con conexión en ese teléfono puede entrar sin conexión durante 7 días.
- Sin conexión no se permiten ventas a crédito ni en divisa. Máximo 300 ventas pendientes por teléfono.
- Si una venta aparece en rojo (rechazada), usa **Reintentar en la caja actual** o **Descartar**.
- El administrador no debe cerrar la caja mientras algún teléfono tenga ventas sin enviar.

## Seguridad

- Si la app pasa más de 2 minutos en segundo plano, se bloquea y pide huella, rostro o el PIN del teléfono. Tras 30 minutos, o si el teléfono no tiene bloqueo de pantalla, se cierra la sesión.
- Configuración → Registro de errores permite enviar a soporte un registro sin ventas, clientes ni contraseñas.

## Impresora Bluetooth

1. Empareja la impresora térmica en los ajustes Bluetooth de Android.
2. En Configuración → Impresora Bluetooth pulsa **Buscar impresoras emparejadas**, elígela y el ancho de papel (58 mm u 80 mm).
3. Pulsa **Imprimir prueba**. Las tildes se imprimen sin acento para que funcione en cualquier impresora.
