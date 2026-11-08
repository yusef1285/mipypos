# MipyPOS Pro Max

## Módulos empresariales v10 — noviembre de 2026

**Avance implementado y probado con regresiones automáticas; no es aprobación de producción.** SQLite pasa de forma aditiva **v9 → v10** (solo `CREATE TABLE IF NOT EXISTS`, sin datos sembrados). El archivo de traslado comercial pasa a **esquema 9** e incluye las tablas nuevas; los archivos de esquema 8 se importan con esas tablas vacías. Las licencias no se modificaron en esta entrega.

### Módulos y pantallas (menú Más)

| Módulo                 | Pantalla               | Quién opera                      | Reglas clave                                                                                                                                                      |
| ---------------------- | ---------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sucursales             | `app/branches.tsx`     | Administrador (auditor consulta) | Código único, prefijo de ticket, áreas asignadas a sucursal, sucursal del dispositivo                                                                             |
| Transferencias         | `app/transfers.tsx`    | Administrador y almacenero       | Envío → tránsito → recepción total/parcial; devolución o pérdida con motivo; cancelación solo sin recepciones. Cada paso deja movimientos de inventario trazables |
| Clientes y proveedores | `app/parties.tsx`      | Administrador (auditor consulta) | Cargos, pagos y anulaciones en libro de solo inserción; límite de crédito; vencidos; el pago no supera el saldo                                                   |
| Monedas y tasas        | `app/currencies.tsx`   | Administrador                    | Moneda base (CUP por defecto), tasas históricas sin fecha futura; la base no cambia después de usarse                                                             |
| Nómina                 | `app/payroll.tsx`      | Administrador                    | Borrador → aprobada → pagada / anulada; importes congelados; aporte del empleador configurable                                                                    |
| Socios                 | `app/partners.tsx`     | Administrador                    | Participaciones activas ≤ 100 %; aportes, retiros y dividendos con anulación por contrapartida                                                                    |
| Consolidado            | `app/consolidated.tsx` | Administrador y auditor          | Ventas, tickets, inventario, tránsito, saldos, nómina, capital y caja por sucursal y periodo                                                                      |

Todas las mutaciones son comandos idempotentes (`commandId` UUID) que viajan por LAN con el mismo permiso que en local. Los movimientos en efectivo exigen caja abierta y entran en el arqueo (`otherCashNet`); el efectivo en divisas se muestra aparte y no se suma al arqueo en moneda base. Los tickets impresos llevan numeración por sucursal (`PREFIJO-000001`); la restricción Pro de impresión no cambió.

### Límites conocidos

- El inventario en tránsito se valora al `unit_cost` capturado al enviar; puede haber una pequeña desviación frente al costo promedio ponderado posterior.
- El consolidado agrupa por día calendario local del dispositivo.
- La nómina no aplica presunciones legales (tablas, topes, retenciones); la tasa de aporte es configurable y debe validarla un contador.
- No hay réplica LAN completa ni autonomía sin conexión para los clientes; tampoco recuperación cuando se pierde la base original.
- Sin prueba física en Android/APK de estas pantallas.

### Verificación

`npx tsc --noEmit`, `npm run lint` (0 advertencias), `npm run format:check` y `npm run lint:css` limpios. **332/332** pruebas: 118 POS + 6 seguridad + 77 LAN + 24 finanzas + 47 ONAT + 45 recuperación + 15 empresariales (`scripts/business-regression.test.ts`, resultados en `.expo/business-regression-results.json`).

## Conciliación de recuperación — continuidad v9

**Avance implementado, no finalización total ni aprobación de producción.** La base existente se actualiza de forma aditiva **v8 → v9**, con copia privada previa y transacción de migración. Se conservan usuarios, hashes, licencias, cuotas y datos comerciales. El formato de traslado empresarial permanece en **esquema8**: el journal privado no se transfiere por LAN ni se incluye en los archivos comerciales.

### Copias antiguas con cambios posteriores

`lib/recovery-journal.ts` captura INSERT/UPDATE/DELETE mediante triggers en la misma transacción que cada cambio empresarial. Incluye imágenes anteriores/posteriores, identificador aleatorio estable por cambio, secuencia y linaje UUID de la instalación. Una transacción fallida tampoco deja cambios confirmados en el journal. Los registros de respaldo/restauración y el estado diagnóstico no se confunden con operaciones comerciales.

La restauración compara íntegramente el prefijo de ambos historiales y solo acepta una continuación de la misma autoridad y linaje, sin huecos. Reconstruye la copia en una generación aislada mediante imágenes de filas, **no vuelve a llamar a ventas, consumos, pagos ni mutaciones de dominio**. Suspende triggers únicamente en ese candidato para evitar repetir efectos; vuelve a instalarlos dentro de la misma transacción. Comprueba cada imagen anterior, referencias, integridad, versión, esquema e igualdad final con el estado actual antes de activar la generación mediante el selector durable existente. Conserva todos los recibos LAN para que los reintentos devuelvan la confirmación original.

Una copia v8 de estado empresarial idéntico sigue siendo restaurable: solo se migra el candidato, nunca el archivo fuente. Una copia v8 divergente se bloquea porque no tiene evidencia histórica retrospectiva. También se bloquean ramas diferentes, imágenes incompatibles, journal incompleto, cambios no registrados, pendientes ambiguos y bases actuales corruptas. El arranque v9 no recrea silenciosamente un journal perdido ni una captura ausente, ocultando un intervalo sin evidencia.

En Ajustes se puede **seleccionar cualquiera de las copias registradas**, comprobarla y ver si coincide, si necesita conciliación posterior o si está bloqueada. La comprobación no modifica ni activa la copia. Todas las validaciones se repiten bajo la barrera de mantenimiento al restaurar; la inspección previa no es una autorización permanente.

### Identidad durable y prevención de reinicios vacíos

`lib/recovery-anchor.ts` guarda la autoridad instalada en SecureStore y un testigo de presencia fuera de SQLite. El primer arranque reserva la creación antes de abrir el archivo y confirma la identidad después del commit. Al reabrir o migrar se comprueba la autoridad; una base vacía que reemplace la instalada no vuelve a generar administrador ni licencia. Una identidad ausente, dañada o incompatible bloquea el arranque sin regenerar evidencia.

Si falta `mipypos.db` y hay ancla o archivos privados/migraciones/WAL conservados, no se abre SQLite ni se crea otra base. Tampoco se utiliza una copia antigua automáticamente. Una instalación previa sin ancla y con su base presente continúa migrando y conserva cuentas, autoridad y cuotas. El selector de restauración debe coincidir con la identidad externa.

Esta protección **no recupera las operaciones de un archivo perdido**: el catálogo y el journal siguen dentro de la base. Hace falta un catálogo autenticado independiente y una conservación verificable de los cambios posteriores. Si se borran simultáneamente todos los archivos, el testigo y SecureStore, no existe evidencia local para distinguirlo de una instalación nueva. Un fallo durante la reserva sin archivo o pérdida parcial del ancla queda bloqueado para revisión; no hay reparación automática de ese estado. La semántica de SecureStore y los cortes de energía requieren pruebas Android.

### Límites concretos

- Hace falta una base actual íntegra y su historial completo. **No resuelve pérdida/corrupción de la base original ni reúne ramas de terminales independientes.** No inventa confirmaciones de dispositivos desconectados.
- Se mantiene el requisito de administrador reautenticado, modo independiente, cola local sin operaciones ambiguas, copia previa, cierre/reapertura y confirmación final. Los journals LAN pendientes no se borran ni reenvían durante la restauración.
- El journal contiene datos sensibles y ocupa espacio creciente. No se poda sin un contrato de retención probado; permanece dentro de SQLite privado, con el respaldo automático Android excluido. No constituye un paquete portátil cifrado ni una copia externa ante pérdida del teléfono.
- Las pruebas usan SQLite `sql.js` y APIs nativas simuladas. La captura de Ajustes a320pt vuelve a mostrar login: **la revisión visual autenticada está incompleta**. No se generó APK ni se probaron WAL/SHM, pérdida de energía, OCR, impresión o LAN física en Android.
- La misión integral y los módulos empresariales restantes siguen abiertos en `lib/offline-acceptance.md`; esta implementación no convierte fases posteriores en funciones terminadas.

### Regresión añadida

`npm run test:recovery` ejecuta la suite dedicada y `npm run validate:pos` ahora incluye las cinco suites. El artefacto `.expo/recovery-regression-results.json` registra resultados nuevos. Cubre migración8→9/reintento/rollback, compatibilidad8, conservación de venta y recibos tras respuesta perdida, cambios/borrados, prefijos divergentes, huecos, imágenes alteradas, paginación, recuperación repetida, fallos de seis etapas, consumo/anulación, costo histórico/rentabilidad, fiscalidad/inmutabilidad y comprobación previa. El timestamp de consulta financiera se valida aparte: no es un dato empresarial persistido.

### Verificación de esta continuación

**309/309 regresiones aprobadas:** 116 POS, 77 LAN, 24 finanzas, 47 ONAT y 45 recuperación. Los cinco artefactos `.expo/*-results.json` tienen marcas del 31 de octubre de 2026 entre 22:11:22 y 22:12:03 UTC. Se añadieron 13 casos sobre creación reservada, archivo perdido, reemplazo vacío, autoridad ajena, pérdida/corrupción del ancla y testigo, reinicio tras commit, migración v8 y almacenamiento seguro bloqueado. TypeScript limpio, parsers CSS aprobados y lint **0 errores/4 advertencias** de dependencias de efectos ya revisadas y conservadas por su función de invalidación. Se ejecutó el formateador; no se acredita un `format:check` independiente. Las 296 pruebas de la entrega anterior se mantienen dentro de este total.

**Expo Doctor actual falló (exit1)** al evaluar `node node_modules/expo/bin/cli config --json --full`. La herramienta no devolvió el stderr que identifica la causa; la inspección de config/imports/plugins no encontró un defecto atribuible con certeza. `expo install --check` salió0 y el árbol de dependencias resuelve limpio. Por tanto, **no se reutiliza el20/20 anterior como aprobación actual ni se afirma compilación nativa satisfactoria**. Falta obtener el diagnóstico completo y resolverlo antes de construir.

No se generó un APK ni se ejecutaron dispositivos/emuladores en esta continuación. La documentación de Bilt describe compilación Play en formato AAB (`https://bilt.me/docs/guides/publish-to-google-play#step-5-build-and-upload-your-first-app-bundle`); no equivale a un APK instalable entregado aquí. Se mantienen más abajo las instrucciones de compilación externa del proyecto.

## Continuación anterior de la misión prioritaria — 31 de octubre de 2026

**Entrega parcial; producción NO APROBADA.** Se continuó sobre SQLite v8 sin reiniciar datos, alterar licencias ni añadir dependencia de Internet. Esta ejecución implementa protecciones de recuperación y contratos; no implementa los módulos empresariales restantes ni autonomía LAN.

### Recuperación implementada

- `lib/database-maintenance.ts` bloquea operaciones y drena conexiones durante mantenimiento. La restauración exige administrador reautenticado, confirmación expresa y modo independiente; detiene/drena el host y rechaza journals pendientes sin borrarlos.
- `restorePrivateRecoveryBackup` comprueba copia privada, estructura e igualdad del estado empresarial y de recibos confirmados. Si una copia antigua difiere, conserva ambas y bloquea la restauración: **no fusiona ni concilia automáticamente operaciones divergentes**.
- Crea copia previa, nueva generación SQLite y auditoría; verifica integridad, claves foráneas, versión v8, autoridad y revisión antes de activar. Conserva original y archivos auxiliares; no sustituye un archivo abierto.
- `lib/recovery-selector.ts` persiste intención antes de copiar y confirma después de reabrir. Fallos de copia/cierre/reapertura/confirmación y pérdida/corrupción del selector están cubiertos por regresiones. Si hay generaciones recuperadas y se pierde el selector, impide volver silenciosamente a la base original.
- Al activarse la generación se invalida la sesión aunque falle la actualización visual. Las copias privadas permanecen en el dispositivo, contienen cuentas y **no son un archivo portátil cifrado ni protegen frente a desinstalación/pérdida del teléfono**.
- `android.allowBackup=false` y reglas XML legacy/cloud/device-transfer generadas por `withLocalHotspot` excluyen SQLite y preferencias del respaldo automático Android. Exige regenerar y recompilar el manifiesto y comprobarlo en Android real.

### Contratos y calidad

Se validan resultados locales/LAN antes de retirar pendientes; un recibo inválido no confirma una operación. Se sustituyeron assertions inseguras por contratos comprobados de mutaciones, finanzas, TLS, descubrimiento y fiscalidad, conservando pagos históricos y compatibilidad de archivos.

**264/264 regresiones:** 116 POS, 77 LAN, 24 finanzas y 47 ONAT. Artefactos `.expo/*-results.json` del 31 de octubre de 2026, 21:36:57–21:37:23 UTC. TypeScript y CSS limpios; lint **0 errores / 4 advertencias**, frente a las 77 iniciales, sin supresión global. Las cuatro advertencias restantes son dependencias de efectos de actualización: `revision` en inversión/consumo/panel financiero y contexto de red en `LanConnection`; se conservan para recargar tras cambios. Se ejecutó el formateador, no una comprobación independiente `format:check`. Expo Doctor 20/20 y alineación de dependencias corresponden a la comprobación anterior, no a una nueva prueba Android.

Las pruebas utilizan `sql.js`, transporte y APIs nativas simulados. La captura actual de `/settings` a 320pt muestra login: **no verifica los controles autenticados de recuperación**. No se generó ni instaló APK, ni se probó pérdida de energía/WAL/SHM, respaldo del sistema, OCR, impresión o LAN entre teléfonos físicos. Las instrucciones de compilación y aceptación externa siguen más abajo.

### Pendiente real del encargo

Recuperación de versiones divergentes o base original perdida; multinegocio/multisucursal; traslados con recepción; clientes/proveedores/créditos; personal/nómina; multidivisa; socios/aportes; integración fiscal empresarial; tickets por establecimiento y consolidación; réplica bidireccional/autonomía LAN; aceptación Android y compilación instalable. La matriz `lib/offline-acceptance.md` separa implementado, integrado, prueba automática, prueba Android, validación externa y pendiente. No se presenta esta entrega como finalización total.

## Resultado anterior de cierre e integración — 31 de octubre de 2026

Los resultados siguientes registran la entrega anterior de 221 pruebas; la sección de continuación anterior contiene la evidencia vigente.

**Salida a producción: NO APROBADA. MipyPOS Pro Max no está terminado.** La aprobación automatizada de los módulos existentes no demuestra que todos los módulos solicitados existan ni sustituye una validación Android real. No se generó ni instaló un APK en esta ejecución.

### Correcciones entregadas

- **Reintentos fiscales:** `useOnat` conserva la identidad del comando mientras el mismo envío no está confirmado, aunque el formulario genere otra UUID; bloqueo inmediato de doble pulsación. Se prueba una reserva confirmada cuya respuesta se pierde: el reintento no crea un segundo registro. Esta identidad de interfaz dura mientras la pantalla permanece montada; no es un nuevo journal de borradores ni una solución universal después de cerrar la app. Los journals LAN existentes se mantienen.
- **Exportación Empresa/Socio:** las filas Excel y el HTML utilizado por PDF/impresión respetan el ámbito seleccionado. La solicitud auditada conserva ese ámbito opcional y el traslado lo valida; los registros antiguos sin ámbito siguen siendo legibles.
- **Recordatorios:** cada recarga fiscal autorizada concilia las notificaciones locales de obligaciones pagadas, declaradas según su tipo o anuladas. Un pago parcial no las cancela. Solo elimina identificadores de obligaciones presentes y cumplidas en los datos cargados; no elimina otras alertas. Un fallo de cancelación se informa con reintento sin descartar los datos ni repetir un pago. No permite programar sobre una obligación ya cumplida. Anular un pago/constancia no vuelve a programar una alerta automáticamente. Sin conciliación en segundo plano de terminales desconectadas: se aplica cuando cada terminal actualiza ONAT.

### Verificación ejecutada

`lint:css` ejecutó parsers CSS y las cuatro suites encadenadas de `validate:pos`. Resultados frescos de `.expo/*-results.json`: **85 POS + 67 LAN + 22 finanzas + 47 ONAT = 221/221**, cero fallos, generados el 31 de octubre de 2026 entre 20:27:57 y 20:28:19 UTC. Se añadieron 12 casos ONAT. TypeScript y CSS limpios; lint **0 errores / 77 advertencias** sin suprimir; formateador ejecutado, sin afirmar un `format:check` independiente. Expo Doctor **20/20**, dependencias actualizadas y árbol resuelto.

Las pruebas usan SQLite `sql.js`, transporte simulado y dobles de APIs nativas. Las capturas de `/onat` (320pt) y `/onat-edit?mode=record` (402pt) muestran login, no los controles autenticados. No hay comprobación visual completa ni prueba física Android de notificaciones, OCR, archivos, impresora, TLS, NSD, Wi-Fi Direct o recuperación WAL/SHM.

### Bloqueos de la entrega anterior (histórico)

La restauración conservadora y la calidad evolucionaron en la continuación documentada al inicio; los módulos empresariales de esta tabla siguen pendientes.

| Área                 | Problema real y consecuencia                                                                                                                                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A30/A32 recuperación | Falta restauración privada asistida con barrera global, drenaje LAN, cierre/reapertura y reconciliación de recibos. Restaurar una copia antigua sin eso puede perder confirmaciones y provocar reenvíos ambiguos; la app no habilita esa sustitución insegura. Legado sin ancla, corrupción doble o pérdida de clave siguen bloqueados conservadoramente. |
| A31 réplica          | El cliente no tiene réplica integral de ventas, movimientos, finanzas o fiscalidad; no actúa como segunda autoridad desconectada.                                                                                                                                                                                                                         |
| A33/A34              | No existen multinegocio/multisucursal ni traslados empresariales con recepción parcial y compensaciones. Las áreas actuales no son sucursales.                                                                                                                                                                                                            |
| A35–A38              | No existen módulos operativos de personal/nómina, crédito/abonos, clientes/proveedores ni multidivisa histórica con caja por moneda. Los complementos ONAT no los sustituyen.                                                                                                                                                                             |
| A39–A41              | Faltan tickets con identidad histórica por establecimiento, consolidación empresarial local y gestión de aportes/participaciones de inversores. La inversión en inventario existente no es ese módulo.                                                                                                                                                    |
| F02/F08              | No hay paquete de reglas fiscales certificado para cada régimen ni integración automática con nómina/gastos/bancos/multisucursal. Las tasas de prueba no son tasas legales.                                                                                                                                                                               |
| Aceptación           | Pendientes compilación/instalación y recorridos autenticados Android, dos dispositivos sin internet, interrupción/reinicio, restauración de datos anonimizados y apertura/compartición/impresión reales.                                                                                                                                                  |

SQLite permanece **v8**; no se cambia la licencia, contraseñas, cuotas ni identidad de publicación; no se utiliza una base de producción. Se conserva la matriz `lib/offline-acceptance.md` como fuente de pendientes. Este avance corrige fallos concretos, **no concluye todos los módulos solicitados ni certifica producción**.

## MipyPOS ONAT — integración del 31 de octubre de 2026

Módulo independiente de preparación y control fiscal offline. Acceso en **Más → MipyPOS ONAT**, rutas `/onat` y `/onat-edit`. Conserva el diseño actual, SQLite local, licencias, credenciales e identidad de publicación; sin backend obligatorio, conexión ONAT ni ejecución de pagos.

### Implementado

- Asistente fiscal TCP/micro/pequeña/mediana/otro, datos de inscripción y contador, vigencias e historial inmutable. Perfiles por contribuyente/NIT independientes. Un solo contribuyente reutiliza ventas POS para evitar asignación duplicada; otros usan bases manuales.
- Motor separado `lib/onat-engine.ts`: porcentaje, tramos marginales, cuota fija, mínimo exento y bonificación; bases de ingresos, ingresos menos deducciones, utilidad, salarios, dividendos o manual. Periodicidad diaria/mensual/trimestral/anual/personalizada; vencimiento configurable por día/mes, sin presumir calendarios legales.
- Reglas con fuente, disposición/número/año/artículo, evidencia de revisión, actividades/municipios/categorías, ámbito empresa/socio e historial. Sin tasas precargadas. Se bloquea confirmación sin comprobación registrada, fuera de vigencia/categoría/actividad/municipio, en períodos incompletos o cuando faltan costos históricos deducibles. El simulador puede usar reglas no verificadas y lo advierte.
- Obligaciones con snapshot del perfil, regla y economía, base e importe explicado; bloquea solapamientos por impuesto/período/beneficiario. Anticipos vinculados a claves de impuestos, pagos acreditados identificados, sin reutilización y sin devolución automática. Una anulación de anticipo acreditado exige primero anular la liquidación afectada.
- Reutiliza ventas netas, devoluciones/descuentos y costos históricos del motor financiero. Los retiros no son gastos; la deducción de costo vendido es explícita por regla. Registros complementarios de gastos deducibles para una regla específica, salarios y dividendos por socio; no sustituyen los módulos empresariales ausentes.
- Pagos tributarios ya realizados con referencia/código/cuenta/medio/fecha/observaciones y adjunto PNG/JPEG/PDF persistido en SQLite (máximo 700 KB). Detecta referencias repetidas; anulaciones justificadas sin borrar/editar confirmados. Declaraciones: constancia de una presentación realizada fuera de MipyPOS, nunca presentación desde la app.
- Panel con estimados/pagados/pendientes, comparación de períodos, evolución y distribución; calendario con verde/amarillo/rojo/gris; provisiones acumuladas, cobertura y reserva sugerida configurable. Las provisiones no mueven caja ni representan saldo bancario; no hay conciliación bancaria automática ni reserva real de fondos.
- Simulador no persistente; reportes de preparación PDF/Excel/impresión, advertencia explícita de no oficialidad y registro de solicitud de exportación (no confirma entrega del archivo). Excel conserva requisito Pro existente. Web usa impresión del navegador para PDF.
- Autorización fiscal expresa en Usuarios para usuarios no administradores, incl. contador representado por usuario autorizado (sin nuevo rol contable). Comprobaciones en repositorio, servicio SQLite y host; revocación efectiva en solicitudes. Auditoría de configuración, reglas, registros, anulaciones, permisos y solicitudes de documentos.
- Migración aditiva **v7 → v8**: `users.can_manage_fiscal` y `fiscal_profiles/fiscal_rules/fiscal_records`. Conserva snapshot previo privado, transacciones/WAL/FK; no reinicia base. Triggers impiden UPDATE/DELETE de registros fiscales. Traslado v2/esquema8 incorpora perfiles, reglas, registros y adjuntos; lee esquemas5/6/7 con fiscal vacío y permiso desactivado. Importación valida snapshots/cálculos/referencias/anticipos y revierte si son incoherentes. Copias privadas completas incluyen nuevas tablas; restauración asistida privada sigue pendiente del proyecto.
- LAN: consultas y mutaciones fiscales específicas mediante TLS/pinning existente, autorización en host, idempotencia/journal/recibos. No se introducen datos fiscales en snapshot general de catálogo. La terminal cliente desconectada no tiene réplica fiscal integral: requiere el host LAN disponible, no internet.
- Recordatorios de sistema locales Android/iOS opt-in, fecha elegida a las 09:00 y mensaje sin importes/NIT; web avisa que solo dispone de calendario interno. Requiere nueva compilación y pruebas de permisos/cierre/reinicio. No usa push remoto.

### Referencia oficial consultada (no paquete de tasas certificado)

Se consultó la **Gaceta Oficial especial n.º 1 del 12 de enero de 2026**, Ley113/2012 concordada, en el sitio oficial del Parlamento:
<https://www.parlamentocubano.gob.cu/sites/default/files/documento/2026-02/goc-2026-es1.pdf>.
La publicación enumera concordancias con Ley181/2025 (presupuesto2026) y Decreto-Ley93/2024, entre otras. Se identifican conceptos y artículos de bases/obligaciones: ingresos personales20/25/49–52; utilidades72/73/110; ventas135; servicios148; seguridad social289/299–300; contribución territorial305/308; socios26. No se incorporaron porcentajes ni escalas como vigentes: falta contrastar normativa complementaria, modificaciones posteriores y aplicación individual. El portal ONAT no se pudo recuperar durante la consulta. `verifiedOn` significa comprobación registrada por el usuario autorizado, no certificación automática ni sello de ONAT. Las tasas de tests son **fixtures sintéticas**, nunca catálogo legal.

### Comprobaciones y límites

Última ejecución: **221/221** —85 POS,67 LAN,22 finanzas,47 ONAT—; `npm run validate:pos` incluye ONAT. TypeScript y CSS sin errores, lint0errores/77warnings sin suprimir; formato ejecutado. Expo Doctor20/20, dependencias SDK58 alineadas por parches y árbol resuelto. Artefactos `.expo/*-results.json`. SQLite/transporte/AES usan dobles de prueba; no se actuó sobre una base real.

No se declara módulo fiscal completo/certificado ni listo para producción: faltan reglas cubanas verificadas para cada régimen, formulas especiales, fechas en días hábiles y feriados, condiciones complejas de exención/bonificación, pérdidas compensables, fraccionamientos legales, restauración privada asistida y aceptación física Android de adjuntos/notificaciones/PDF/impresora/LAN/backup. Falta integración automática con nómina/gastos/bancos y multisucursal porque esas entidades no existen todavía. No hay consolidación fiscal empresarial ni ventas por actividad fiscal/sucursal. La vista previa redirigió a login; revisión visual ONAT autenticada pendiente. Pruebas de generación/compartición de PDF/Excel y notificaciones son nativas pendientes, no se sustituyen por los tests del motor.

Aceptación externa: configurar perfil real; contrastar cada regla con contador/ONAT; comprobar importes con ejemplos legales; recorrer pagos parciales/anulaciones, anticipos y socios; abrir todos los archivos; reinstalar/restaurar datos anonimizados; probar dos Android sin internet y permisos revocados. Los recordatorios cumplidos se concilian localmente al recargar ONAT; no hay conciliación automática en segundo plano entre todos los terminales desconectados.

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
- SQLite local mediante Expo SQLite (datos comerciales); AsyncStorage/SecureStore para estado auxiliar y secretos
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
- Cierre completo: administrador, caja cerrada, sin pendientes y modo independiente en origen/destino. Exportaciones permite guardar/compartir JSON versionado con checksum SHA-256, todos los registros del negocio, usuarios sin contraseñas ni hashes en archivos v2 (los hashes del origen permanecen intactos), secuencias, cuotas acumuladas e imágenes. No se copia licencia, identidad TLS, tokens ni configuración de red. Importación solo en destino sin productos/ventas/movimientos/turnos; valida columnas, referencias, stock y sumas, y revierte si falla. Propone el efectivo físico del último cierre como fondo de apertura; no abre caja automáticamente. El checksum detecta daños, **no autentica al remitente ni cifra el archivo**. El JSON y la galería contienen información personal: compartir únicamente por un canal de confianza y controlar copias/acceso. Límite de recepción 150 MB. Tras exportar, no continuar vendiendo en el origen ni operar ambos como negocios separados: el archivo es un traspaso, no sincronización entre hosts.
- Usuarios: crear cuenta con rol `auditor` y contraseña propia; no se crea una contraseña universal. El auditor entra en otro teléfono por QR y abre Más → Auditoría. Consulta ventas con detalle/comprobante, movimientos, existencias por área y cierres; actualiza cada 5 s. No puede vender, retirar efectivo, modificar usuarios/productos/inventario ni abrir/cerrar caja. El host verifica permisos en cada operación. Mantener el vendedor en primer plano.
- Wi-Fi Direct: Android propietario en teléfono vendedor, `WifiP2pManager` real, descubrimiento y unión al propietario del QR, TLS/pin y credenciales de usuario conservados. Permitir dispositivos cercanos (Android 13+) o ubicación (Android 12 y anteriores); activar Wi-Fi y ubicación para descubrimiento. Aceptar solicitud Android. Hotspot sigue siendo una opción separada, no un sustituto silencioso de P2P. Cambio de grupo o reinicio requiere regenerar y escanear QR. No funciona en Expo Go, web ni iOS.

### Pruebas adicionales en dos Android — pendientes de ejecución

1. Nueva compilación instalada en A/B. Sin internet ni datos móviles desde antes del primer arranque: leer comprobante nítido y borroso, permisos cámara/galería denegados y cancelación. Comprobar imagen en galería y datos conservados tras reiniciar A y B. Adjuntar los ejemplos reales de mensajes para ajustar la extracción: todavía no se recibieron.
2. Venta 100 CUP, recibido 150 → vuelto 50, caja +100. Recibido 99 o vacío → rechazo sin descontar stock. Mixto 40 efectivo +60 transferencia, recibido 50 → vuelto 10; transferido distinto de 60 → rechazo. Comprobante sin datos/revisión → rechazo. Repetir referencia/imagen → rechazo, pero reintentar el mismo UUID tras desconexión → una venta.
3. A crear Wi-Fi Direct y QR; B escanear, aceptar emparejamiento y entrar como vendedor. Probar ventas simultáneas del caso 4 anterior, pérdida de red antes/después del commit, cancelación de Android, timeout, reconexión tres veces y cambio de IP/QR con pin persistente. Verificar que no hay tráfico HTTP ni a datos móviles.
4. A seguir vendiendo; B iniciar sesión como auditor. Revisar ventas, recibidos/vueltos, comprobantes, entradas/traslados, stock y cierres; intentar todas las mutaciones desde UI y solicitudes de prueba → denegadas. Consultar mientras A confirma una venta: totales/stock coherentes y sin cerrar la caja.
5. Cerrar A con extracción real y diferencias autorizadas; desconectar terminales, modo independiente, enviar JSON. En B independiente y vacío importar, entrar con usuarios recibidos, revisar historia, autorizadores, importes, cuotas, stock por área e imágenes. Licencia B no cambia. Fondo siguiente coincide con efectivo físico de A. Archivo incompleto, versión ajena, segundo import o destino con datos → rechazo sin cambios. No continuar operaciones en A.

Las pruebas automatizadas de Java son guardas estáticas; no prueban compilación, OCR, guardado MediaStore, discovery P2P, handshake ni radio Wi-Fi. Registrar modelos/Android, versión APK, esperado/observado y evidencias antes de declarar aprobado cada caso.

## Ampliación financiera: consumo, inversión y rendimiento

Se conserva SQLite local, el inventario por áreas, CUP, la navegación y la identidad visual. No se añadió un backend ni se modificaron la activación o los hashes existentes.

### Secciones y permisos

- Más → Consumo interno: registrar, anular o rectificar retiros con motivo, observaciones y autenticación del autorizador. Administrador o supervisor con permiso explícito; un vendedor necesita autorización. Las rectificaciones conservan el registro original, su reversión y el reemplazo.
- Más → Inversión y costos, también accesible desde Productos: costo actual e historial, entradas con costo promedio ponderado, búsquedas, categoría, ordenamiento y Excel.
- Más → Rentabilidad y Rendimiento de vendedores: exclusivos del administrador tanto en pantalla como en la API local/LAN. Los costos se eliminan de las respuestas destinadas a otros roles.
- Más → Ajustes de ventas: administrador autenticado, descuentos, devoluciones y anulaciones auditables. Las devoluciones restituyen existencias al área original y asignan el reembolso a los medios de pago originales. El efectivo solo se devuelve con una caja abierta y saldo suficiente.
- Usuarios: el administrador puede habilitar o retirar la autorización de consumo a supervisores.
- Excel conserva la regla existente de licencia Pro; esta ampliación no cambia la licencia.

Un consumo descuenta stock pero no crea una venta, pago ni cuenta por cobrar. No cambia el efectivo esperado. Si el producto está en el carrito sin cobrar de ese dispositivo, se bloquea el consumo hasta quitarlo y reclasificarlo correctamente; también se bloquea cuando hay una venta LAN pendiente que contiene ese producto. El carrito de otro terminal no se sincroniza: su cobro vuelve a validar existencias en el host.

### Base de datos y conservación histórica

Esquema/archivo de negocio v6, compatible con importaciones v5:

- `products.unit_cost`: costo actual nullable; `users.can_authorize_consumption`: permiso explícito de supervisor.
- `sales.seller_id`: identificador estable del vendedor; `sale_lines.unit_cost` y `sale_lines.category`: copia histórica al confirmar la venta.
- Tablas `cost_history`, `internal_consumptions`, `consumption_events`, `sale_adjustments` y `finance_commands`.
- Movimientos ampliados con `CONSUMO_INTERNO`, `ANULACION_CONSUMO` y `DEVOLUCION`, manteniendo los movimientos existentes y sus identificadores.

Las operaciones financieras guardan cambios y recibo del UUID en una transacción. Un reintento con el mismo contenido devuelve el resultado previo sin repetir stock o importes. Los archivos de traslado incluyen el historial financiero y sus recibos; no son un sistema de sincronización entre dos hosts independientes. Las ventas antiguas no reciben costos ni identidades inventadas: costo desconocido y agrupación heredada por nombre cuando falta el identificador.

### Cálculos y límites

- Ventas netas = ventas brutas − descuentos − devoluciones/anulaciones.
- Costo vendido = suma de cantidad × costo histórico de cada línea, menos el costo histórico de las unidades devueltas/anuladas. Un descuento monetario no devuelve inventario ni elimina su costo.
- Ganancia bruta = ventas netas − costo vendido. Margen = ganancia bruta / ventas netas × 100 solo cuando las ventas netas son positivas. No equivale a ganancia neta: no resta gastos operativos.
- Costo promedio ponderado = (stock anterior × costo anterior + cantidad recibida × costo de entrada) / stock resultante. Si hay stock previo sin costo conocido, debe registrarse su costo antes de mezclar entradas.
- Inventario disponible = stock actual × costo actual. Es una valoración actual, con fecha de consulta, no una reconstrucción del inventario al cierre del período. Tanto el total como cada categoría señalan valores parciales si hay existencias sin costo.
- Los costos desconocidos nunca se convierten en cero para presentar una ganancia definitiva: se muestra `Pendiente de costo`; las sumas conocidas se identifican como parciales.
- Los períodos incluyen el inicio y final de cada día. Las ventas se atribuyen a su fecha y los descuentos/devoluciones/anulaciones a la fecha del ajuste. Los gráficos y agrupaciones usan los mismos filtros; la semana empieza el lunes.
- Las ventas mixtas suman una sola venta. La modalidad de pago afecta caja, no el costo histórico. El consumo y sus reversiones permanecen separados de las ventas y del rendimiento de empleados.
- Todo se expresa en CUP; no se introdujo conversión ni mezcla de monedas.

### Archivos de implementación

- Datos e integración: `lib/database.ts`, `lib/models.ts`, `lib/finance.ts`, `lib/finance-models.ts`, `lib/finance-calculations.ts`, `lib/finance-privacy.ts`, `lib/permissions.ts`, `lib/pos-repository.ts`, `lib/use-pos-repository.ts`, `lib/business-archive.ts`, `lib/network/operations.ts`, `lib/network/host.ts`, `lib/sale-draft.ts`, `lib/use-finance-command.ts`.
- Pantallas y navegación: `app/consumption.tsx`, `app/investment.tsx`, `app/profitability.tsx`, `app/seller-performance.tsx`, `app/sale-adjustments.tsx`, `app/users.tsx`, `app/products.tsx`, `app/(tabs)/sales.tsx`, `app/(tabs)/more.tsx`, `app/_layout.tsx`.
- Controles compartidos: `components/FinanceDashboard.tsx`, `components/FinanceSummary.tsx`, `components/FinanceControls.tsx`, `components/FinanceChart.tsx`, `components/FinanceSelect.tsx`, `components/DateInput.tsx`, `components/DateInput.web.tsx`, `lib/finance-periods.ts`. La variante `lib/receipt-camera.web.ts` evita importar el puente OCR Android en web.
- Dependencias y comprobación: `package.json`, `package-lock.json`, `scripts/finance-regression.test.ts`; se incorpora el selector de fecha nativo y se alinean versiones Expo.

### Verificaciones ejecutadas y aceptación pendiente

`npm run validate:pos` ejecutó 104 pruebas: 55 POS, 27 LAN/seguridad y 22 financieras; todas aprobadas. Estas últimas cubren consumo/caja, reversión y rectificación, costo histórico, promedio ponderado, costos pendientes, filtros, vendedor estable, pagos mixtos, ajustes, permisos, exportaciones de datos, repetición idempotente y archivos v5/v6. TypeScript y CSS sin errores; lint sin errores con 17 advertencias. Expo Doctor: 21/21 comprobaciones aprobadas en la validación de dependencias.

Las regresiones utilizan SQLite mediante el harness y transporte LAN simulado: no certifican el APK, la radio Wi-Fi ni la reapertura de la base nativa tras matar el proceso. El preview redirige al login; no se inspeccionaron visualmente los paneles autenticados. No se verificó en un teléfono la apertura y compartición del archivo Excel.

Checklist adicional **pendiente**, sin datos de producción:

1. En APK Android sin internet, introducir costos, vender en efectivo/transferencia/mixto y comparar caja, líneas históricas, paneles y Excel; modificar el costo actual y comprobar que la venta pasada no cambia.
2. Intentar consumo sin autorización y con supervisor sin permiso: rechazo. Autorizar consumo, anular y rectificar: comprobar stock por área, historial y efectivo inalterado.
3. Añadir producto al carrito, intentar consumirlo: bloqueo hasta quitarlo. Repetir con venta LAN pendiente. En dos terminales competir por últimas unidades: ninguna operación debe dejar stock negativo.
4. Probar cada período y fechas personalizadas, vendedor renombrado, producto/categoría sin costo y márgenes negativos; contrastar con los registros almacenados.
5. Descontar, devolver parcialmente y anular una venta mixta; contrastar devoluciones monetarias, stock, caja, informes diarios y ganancias, sin repetir cantidades ya devueltas.
6. Reiniciar ambos dispositivos antes/después de confirmar, simular respuesta perdida y recuperar UUID: una sola operación. Exportar/importar negocio v6 y revisar costos, consumos, ajustes y permisos; probar un archivo v5 real.
7. Entrar como vendedor, supervisor y auditor, intentar abrir paneles o solicitar costos por LAN: denegación y ausencia de costos. Abrir los informes Excel en un lector y comparar cifras y filtros.

## Pro Max — entrega incremental de auditoría y endurecimiento (2026-10-27)

### Alcance real de esta entrega

Fase 1 implementada y comprobada por software. Fase 2 tiene implementados la migración, permisos de repositorio, recuperación segura del almacenamiento, revisión compartida, caché de catálogo y refuerzos del protocolo; la aceptación Android física sigue pendiente. Las fases 3–8 y la regresión integral de sus nuevos módulos **no están implementadas**. El plan continúa sobre estos cambios, sin reconstruir el POS ni introducir un servidor obligatorio.

Se conservan la identidad visual, los roles, SQLite local, caja, comprobantes, consumos y finanzas existentes. No se modificó el algoritmo de contraseñas ni la activación. Los modelos de dominio que estaban truncados se recuperaron a partir del esquema, componentes y pruebas reales.

### Cambios y migración v7

- `lib/database-migrations.ts`: versión SQLite 7, guardia contra abrir una versión futura antes de escribir, copia SQLite consistente previa en `mipypos.pre-v<versión>.db`, comprobación de integridad y migración transaccional. El respaldo incluye usuarios/hashes y permanece privado dentro del directorio de bases; **no es una exportación compartible**. Si falla la copia, no empieza la actualización. La restauración del respaldo requiere intervención técnica y reconciliar operaciones posteriores; no existe aún una pantalla de recuperación automática.
- `sales.legacy_card`: identifica registros históricos con tarjeta sin borrarlos ni convertirlos a efectivo/transferencia. Triggers impiden insertar tarjeta en las ventas operativas y convertir una venta operativa en tarjeta; la importación histórica autorizada conserva el marcador. `sales.pricing_basis` registra la tarifa efectiva de ventas nuevas.
- `sync_state`: identidad local de autoridad y revisión monotónica basada en cambios reales mediante triggers. Rollback, lectura, actualización sin cambios y replay no adelantan la revisión. No depende de conservar `network_events`. No se traslada esta identidad a otro teléfono.
- `network_replica`: copia de catálogo/áreas/existencias/caja confirmada, separada de las tablas operativas. Se aísla por sesión y host mediante una clave derivada; no guarda tokens. Conserva hasta 16 copias y no participa en exportaciones ni dispara revisiones. **No es todavía una réplica completa de ventas, movimientos ni módulos empresariales.** Nunca se usa una copia vieja para afirmar que la conexión está confirmada o aceptar una venta como definitiva.
- `lib/business-archive.ts` y `lib/database.ts`: traslado formato 7 con lectura compatible 5/6/7, valores neutros para columnas antiguas, validación de relaciones y rechazo si el destino tiene usuarios/áreas/historial propio que podría perderse.

### Ventas, inventario, permisos y red

- `lib/models.ts`, `lib/sale-pricing.ts`, `lib/sale-identity.ts`, `lib/finance.ts`, `app/(tabs)/sales.tsx`: tipos operativos exclusivamente efectivo/transferencia/mixto y tipos históricos explícitos. Mixto aplica **tarifa de efectivo a todas las líneas**, repartiendo el total entre efectivo y transferencia sin aplicar dos precios a un producto. Precio, cantidad, subtotal y costo histórico permanecen guardados; descuentos/devoluciones continúan en el ledger de ajustes existente.
- `lib/database.ts`, `lib/use-pos-repository.ts`: permiso de consumo devuelto en consultas de usuarios, controles de acceso en todas las operaciones del repositorio, validación del rol del vendedor al persistir y bloqueo de movimientos ante discrepancia global/por área. Consumo/reversión/devolución son movimientos físicos vinculados a sus ledgers comerciales ya existentes, no nuevos ingresos de caja.
- `lib/network/config.ts`, `secure-storage.ts`: lectura segura primero; migración del token antiguo solo después de escritura y relectura verificadas. Ante fallo, se conserva el token previo. El host sigue validando autenticación y vencimiento. Configuración normalizada con Wi-Fi predeterminado, identidad de terminal persistida y cliente inválido bloqueado para reemparejar: **nunca se convierte automáticamente en otra autoridad local**.
- `lib/network/validation.ts`, `host.ts`, `client.ts`, `snapshot.ts`: contratos runtime de todas las operaciones del dispatcher y ventas; error explícito para operación desconocida, código y referencia de solicitud. Snapshot coherente y respuesta abreviada cuando autoridad/revisión no cambiaron. Caché y solicitudes en curso aisladas entre cuentas. Las nuevas ventas ligan UUID a contenido; un ACK sin número de venta o rechazo incompleto conserva el pendiente. Recibos heredados sin huella siguen recuperables con las comprobaciones heredadas de terminal y usuario; no pueden ofrecer la comparación de contenido añadida a los nuevos recibos.
- `lib/network/pending-operation.ts`, `pending-sale.ts`, `revocations.ts`: errores controlados al leer registros dañados, sin borrado silencioso ni reenvío inseguro. Una cola dañada requiere revisión técnica de su confirmación; no existe descarte automático.
- `lib/network/tls.ts`: parada idempotente sin inicializar TLS al cargar o parar en web/iOS. El transporte LAN real sigue siendo Android; no se simula una conexión segura en otras plataformas.
- `lib/network/hotspot.ts`, `native/MipyLanModule.java`, `lib/app-context.tsx`, `components/LanConnection.tsx`: eventos nativos de pérdida/disponibilidad, conservación de la solicitud Wi-Fi autorizada para recuperación, reintentos de consulta con espera creciente y menos actividad en segundo plano. Estados conectado/sincronizando/sin conexión/pendientes/error y acción de reintento. La disponibilidad Wi-Fi por sí sola nunca confirma TLS ni una venta.

### Validación de esta entrega

`npm run validate:pos`: **122/122 pruebas aprobadas** (63 POS, 37 LAN/seguridad, 22 finanzas), con informes de ejecución en `.expo`. TypeScript y CSS sin errores; lint sin errores, con 16 advertencias pendientes. Las pruebas añadidas comprueban tarifas diferentes, historia de tarjeta, backup/rollback de migración, permiso persistente, stock inconsistente, migración segura fallida, configuración antigua, errores de protocolo, pendientes dañados, revisión sin log, caché/roles, UUID con distinto contenido y ACK incompleto.

El harness ejecuta SQLite con `sql.js` y transporte simulado. No ejecuta Android Keystore, el backup nativo, radio Wi-Fi, TLS real ni Java en un APK. Se inspeccionó el login y Red local a 320/402 pt; el preview sin autenticación impide comprobar Ventas y Configuración autenticadas. No se afirma validación física ni aceptación completa de Pro Max.

### Pendientes antes de avanzar sobre datos de producción

1. Compilar un APK nuevo y probar dos Android sin internet: conexión, pin, venta con ACK perdido, reinicio del host, reautenticación y recuperación del UUID; apagar/restaurar Wi-Fi y comprobar que la misma autoridad vuelve sin duplicados. Verificar visualmente los cinco estados y que los controles siguen accesibles con teclado.
2. Copias anonimizadas reales v5/v6: migrar, comparar IDs/importes/stock/permisos/credenciales/históricos, matar el proceso durante la migración y probar recuperación técnica desde la copia privada. Nunca usar la única base de producción para estas pruebas.
3. Completar réplica integral: hay catálogo/caja confirmados y operaciones durables, no sincronización integral empresarial ni múltiples operaciones incompatibles confirmadas por hosts independientes. El nuevo descubrimiento NSD y la recuperación cifrada descritos abajo requieren aceptación Android real.
4. Fases 3–7: aislamiento multinegocio/multisucursal, asignaciones, traslados con recepción parcial, personal/nómina/crédito/abonos, nuevos indicadores de cobro/gasto, multidivisa, clientes/proveedores, identidad histórica del ticket y exportaciones consolidadas sin secretos. No hay pantallas simuladas para estos módulos.
5. Archivos antiguos de traslado v1: siguen conteniendo hashes y datos personales y deben tratarse como sensibles. Las nuevas exportaciones v2 no incluyen hashes ni contraseñas; los archivos comerciales siguen conteniendo datos personales y no están cifrados.
6. Desktop: no se dispone del código/API/protocolo de MipyPOS Desktop. Integración, contrato final y pruebas cruzadas siguen pendientes; no se afirma subordinación real ni compatibilidad con una aplicación externa no probada.

### Continuación Pro Max: protección y recuperación (fase 2)

Se continúa el proyecto existente sin repetir la migración SDK 58 ni las correcciones operativas anteriores. Este avance no entrega las fases empresariales 3–8 ni cierra la aceptación física de fase 2.

- `lib/network/pending-store.ts`: journal de dos copias, generaciones y confirmaciones durables (tombstones). En Android/iOS cifra el contenido con AES-256-GCM y conserva la clave exclusivamente en SecureStore. Los comprobantes grandes no se guardan directamente en SecureStore. Verifica cifrado, descifrado y relectura antes de enviar. Migra los pendientes anteriores solo tras verificar las nuevas copias. La huella de las operaciones se recalcula antes de recuperar. Ante una copia dañada, recupera la otra y conserva el daño; si ambas fallan o se pierde la clave, bloquea el reenvío sin borrar evidencias. No puede reconstruir comandos antiguos dañados que nunca tuvieron una segunda copia.
- `pending-operation.ts`, `pending-sale.ts`, `pending-withdrawal.ts`: usan el journal conservando el UUID, la terminal, el usuario y la autoridad. El retiro local web mantiene persistencia con checksum y sin credenciales; no se presenta como almacenamiento cifrado. LAN web sigue bloqueada.
- `client.ts`, `host.ts`, `database.ts`: recibos de ventas y retiros además de los recibos generales. Un rechazo de consulta o un fallo ambiguo nunca descarta un pendiente. Tras un rechazo de mutación, solo una consulta válida a la misma autoridad que confirma ausencia permite liberar el registro. Un recibo confirmado permite recuperar el resultado original, incluso si el host ya cambió de caja o el rol del usuario. Requiere actualizar ambos teléfonos; un host antiguo sin estos endpoints no autoriza el descarte.
- `snapshot.ts`, `client.ts`, `database.ts`: comprueba referencias, IDs/pares duplicados y correspondencia entre stock global y por área. Logout borra las réplicas sin borrar los pendientes; una respuesta antigua no repuebla la copia de otra sesión ni elimina el token nuevo. La copia continúa siendo un caché validado online: no autoriza ventas offline en un cliente desconectado.
- `discovery.ts`, `native/MipyDiscoveryModule.java`, `MipyLanPackage.java`, `withLocalHotspot.ts`, `host.ts`, `components/LanConnection.tsx`: anuncio y búsqueda NSD de hosts en Wi-Fi local, limitados en tiempo y candidatos. Busca únicamente una identidad TLS previamente autorizada por QR; nombres y direcciones descubiertos no otorgan confianza. No utiliza Internet ni un servidor remoto. La búsqueda es bajo demanda y no promete funcionar donde el router bloquea mDNS; QR continúa disponible. Wi-Fi Direct conserva el flujo anterior. Requiere compilar un APK nuevo: Java/radio/NSD no se ejecutaron aquí.
- `business-archive.ts`, `database.ts`, `components/BusinessTransfer.tsx`: nuevo formato de archivo **v2**, separado del esquema SQLite **v7** sin nueva migración de tablas. No exporta `users.password_hash`. Importa formatos v1/v2 y esquemas 5/6/7; no reutiliza las credenciales del archivo, incluso v1. El administrador de origen adopta la clave actual del administrador receptor; las demás cuentas requieren nuevas claves asignadas desde Usuarios. La interfaz lo informa antes de importar. Algoritmo de hash, contraseñas del origen y activación de licencia permanecen sin cambios. Las verificaciones transaccionales y rechazo de destinos con datos propios se conservan.

La validación de esta continuación ejecutó **141/141 pruebas**: 65 POS, 54 LAN/seguridad y 22 finanzas. TypeScript y CSS sin errores; lint con 0 errores y 22 advertencias. Los informes se guardan en `.expo/*results.json`. Incluye recuperación por recibo con ACK perdido de venta/retiro, rechazo posterior a commit, comprobantes grandes cifrados, corrupción simple/doble, huella alterada, migración de pendientes, cambios de sesión con respuestas atrasadas, referencias inconsistentes y archivos v1/v2 sin reutilizar credenciales.

No se operó sobre una base de producción ni se verificó conservación de datos reales. Las pruebas son con fixtures `sql.js`, transporte simulado y AES de Node como doble del puente Expo. La comprobación visual de aquella entrega quedó bloqueada por el servidor de preview pendiente de reinicio tras SDK 58; no se afirmó renderizado validado.

## Continuación A30/A32 — recuperación y copias privadas

**Avance parcial de la fase 1; no cierre de las doce fases Pro Max.** No se alteran esquema v7, hashes existentes, licencias, cuotas, identidad de publicación ni funciones operativas sanas. No backend, Internet obligatorio, servicios de pago, nueva PWA ni Desktop.

### Implementado

- Los nuevos journals de operaciones, ventas y extracciones LAN guardan el pin TLS público original dentro del payload cifrado/autenticado. Si se pierde el pin de configuración y `loadNetworkConfig` devuelve una dirección vacía, escanear un QR de la autoridad original permite recuperar el emparejamiento incluso en una IP nueva, después de comparar **todos** los pendientes y completar TLS. Solo entonces se actualiza la dirección de cada journal usando su autoridad original anclada. Se conservan UUID, contenido y recibos; una IP coincidente nunca basta. Los registros antiguos sin ancla no se rellenan desde el QR ni desde otro pendiente. Pérdida de clave o corrupción doble mantienen el bloqueo y la evidencia.
- Los recibos y reenvíos de nuevas operaciones/ventas usan explícitamente el pin conservado. Extracciones mantienen un mismo pin durante su consulta y envío. Un reintento no cambia la autoridad de un pendiente.
- Un reintento de migración no sobrescribe `mipypos.pre-vN.db`. Una copia existente incompleta o con versión/integridad incorrectas detiene la actualización sin borrarse. Una apertura SQLite fallida puede reintentarse; arranques concurrentes comparten la misma inicialización.
- Configuración incorpora **Copia privada de recuperación** para administradores locales/host en Android/iOS. Requiere contraseña actual y aplica el límite de intentos existente. La capa de datos vuelve a comprobar cuenta y modo de red dentro de la cola de mutaciones. Un cliente LAN no puede presentar su base como copia completa del administrador.
- Cada copia manual tiene UUID propio, incluye la base SQLite completa y sus páginas WAL confirmadas, y se comprueban integridad, referencias, versión y autoridad. Su catálogo y auditoría se confirman juntos solo después de validar la copia. Una interrupción/fallo no borra copias anteriores ni anuncia éxito; un archivo sin catálogo se conserva para revisión técnica.
- **Comprobar última copia** reautentica al administrador y vuelve a validar su cuenta/modo dentro de la cola SQLite. Verifica que el archivo exista antes de abrirlo, correspondencia UUID/nombre, autoridad, esquema v7, `integrity_check` completo y claves foráneas. Lee la copia en conexión separada con `query_only`; devuelve conteos de ventas/productos/cajas/recibos y revisión, nunca filas de cuentas ni hashes. Un archivo ausente, catálogo intercambiado o copia inválida no se elimina ni se repara automáticamente. Comprobar **no restaura** ni modifica la base activa o los journals.

### Privacidad y límites de restauración

Estas copias **contienen hashes y configuración local** porque sirven para conservar íntegramente el negocio. Permanecen en el directorio privado de SQLite; no pasan por exportar, compartir o traslado comercial. Los archivos comerciales v2 siguen sin contraseñas, hashes, licencia, tokens ni claves TLS. El catálogo privado no se incorpora a ese formato.

Una copia SQLite no respalda Android Keystore, SecureStore, journals externos ni imágenes externas; no es una copia íntegra del dispositivo. Las copias privadas pueden perderse al desinstalar o perder el teléfono. No hay eliminación/retención automática ni restauración operativa desde la interfaz. Restaurar una copia antigua puede perder recibos posteriores y permitir duplicaciones desde otros clientes: **no sustituir la base de un host activo**. Falta implementar un mantenimiento de restauración que preserve la base actual y reconcilie operaciones/recibos y autoridad antes de volver a operar.

### Comprobaciones ejecutadas

**171/171 regresiones: 85 POS + 64 LAN + 22 finanzas.** Se añadieron 21 casos respecto a los 150 anteriores: conservación del respaldo original, copia inválida, arranque concurrente, reintento de apertura, recuperación anclada de tres tipos de pendiente, mezcla de anclas/legado, copias completas, autorización y límites, rechazo de cliente, fallos de backup/catálogo y copias simultáneas con venta. El nuevo caso LAN comprueba pérdida del pin y dirección vacía, TLS en una IP nueva, rebind con UUID/huella/pin intactos y recuperación por recibo sin repetir la operación. Los seis casos POS más recientes cubren inspección sin secretos/alteraciones, archivo ausente, autenticación/modo cliente, versión/autoridad alteradas, intercambio de nombres y referencias rotas. TypeScript y CSS limpios; lint **0 errores y 22 advertencias**, sin nuevas supresiones. El fix seguro ejecutó el formateador del proyecto. La comprobación separada `npm run format:check` se aprobó en el avance anterior de 165 pruebas; queda por repetir tras estos últimos cambios.

Pruebas en `sql.js` y transporte simulado; no bases de producción, APK, Android Keystore, recuperación física ni aprobación integral. El preview a 320 pt renderiza el login al abrir `/settings` sin sesión: no valida la nueva sección, que es nativa y autenticada. Verificación visual de esa sección pendiente en APK.

### Aceptación Android todavía pendiente

1. Con una base de prueba, iniciar como admin local, crear dos copias, cambiar precio/vender entre ellas y comprobar que ambas permanecen intactas e independientes. Validar las páginas WAL, versión, hashes/IDs, cuotas y conteos con instrumentación local sin exportar credenciales.
2. Repetir como vendedor y como cliente LAN: no aparece el control y se rechaza la llamada de datos. Probar contraseña incorrecta/límite, espacio insuficiente y fallo/interrupción durante copia o catálogo; no mostrar éxito, no borrar datos/copia previa. Pulsar **Comprobar última copia** y contrastar conteos del snapshot, no los actuales; con instrumentación privada de pruebas retirar/corromper un archivo o cambiar su versión/autoridad y comprobar rechazo sin creación, borrado ni reparación automática.
3. En una compilación de pruebas con dos Android, perder respuesta tras commit en venta, operación y retiro. Eliminar solo el pin de configuración mediante instrumentación de pruebas, conservando journal/clave. QR original + TLS + recibo resuelven una sola vez. QR ajeno, legado sin ancla y clave perdida no reenvían ni borran. Repetir con cambio de IP.
4. Con copias anonimizadas v5/v6/v7, interrumpir actualización, reabrir/reintentar y comprobar que el respaldo previo original no cambió. Restauración técnica debe conservar primero DB/WAL/SHM actuales y detener todos los clientes; su reconciliación y reapertura nativa **no están aprobadas**.

Para preparar Android local: `npm ci`, `npx expo prebuild --platform android`, `npx expo run:android --variant release`. Instalar el APK generado en dos teléfonos de prueba; no presentar el firmado de desarrollo predeterminado como release de producción. Conservar configuración Bilt e identidad/claves de firma existentes. Los bridges TLS/Direct/NSD/OCR requieren compilación nativa, no Expo Go. No se ejecutaron esos comandos nativos en esta continuación.

**Punto de continuidad:** mantenimiento y restauración asistida A32 y legado A30, después A33/A34 y fases empresariales. A33–A41 siguen con su estado anterior; no se añadieron pantallas o tablas aparentes para declararlas implementadas. La evolución global solo podrá comenzar después de integrar y aceptar offline ese alcance.

## Estabilización offline anterior — auditoría y correcciones prioritarias

**Entrega parcial; no se declara listo todo Pro Max ni aceptada la LAN en Android real.** La [matriz de aceptación offline](lib/offline-acceptance.md) contiene 41 áreas, rutas, componentes/servicios, operaciones SQLite, estados, criterios y punto de continuación. Se distingue revisión de fuente, regresiones automatizadas y aceptación física. Los resultados anteriores de 141 pruebas son históricos; el último resultado de esta estabilización es **150/150**.

### Defectos corregidos

1. **Identidad de autoridad:** operaciones remotas pendientes exigen el pin previamente emparejado antes de aceptar QR o cambiar dirección. Si se pierde, no basta la misma IP para confiar en otro host: se conserva el pendiente para reconciliación técnica. Esto reemplaza la antigua actualización automática HTTP por coincidencia de IP cuando no hay identidad verificable.
2. **Sesión:** login y logout LAN se serializan; lecturas/escrituras/borrado del token tienen su propia cola. Una respuesta AUTH_EXPIRED antigua solo borra el token que realmente le corresponde, sin eliminar el de un login posterior.
3. **Permiso local:** crear áreas exige admin también en el repositorio local, igual que UI y host. Se conservan consultas/movimientos del almacenero. El listado de usuarios de Movimientos no se bloqueó indiscriminadamente: alimenta filtros y no devuelve hashes; la minimización del endpoint requiere revisión separada.
4. **Arranque/migración:** creación de tablas/índices, actualización y semillas forman una sola transacción. Un fallo revierte también el esquema inicial y la versión; backup y PRAGMAs de conexión permanecen antes de BEGIN. Se verificó rollback de metadata y registros, además de reintento.
5. **CSV:** se rechazan comillas incompletas/incorrectas, encabezados duplicados/vacíos y filas con cantidad de columnas distinta antes de importar. No se pierden celdas silenciosamente. CSV válido con BOM, comas, comillas escapadas y campos multilínea conserva compatibilidad.

### Archivos y conservación

Cambios funcionales: `lib/network/config.ts`, `lib/network/client.ts`, `lib/app-context.tsx`, `components/LanConnection.tsx`, `lib/use-pos-repository.ts`, `lib/database.ts`, `lib/csv.ts`. Regresiones/harness: `scripts/lan-security.test.ts`, `scripts/pos-regression.test.ts`, `scripts/pos-test-harness.ts`. Documentación: `README.md`, `lib/offline-acceptance.md`. El formateador recorrió el proyecto; no se usa ese recorrido como prueba de cambios funcionales en otros archivos.

**SQLite sigue en v7; no nueva migración ni formato de negocio.** No se reconstruyó el POS ni se borró una base, ni se modificaron hashes existentes, algoritmo, licencia, cuotas o identidad de publicación. No se desarrolló PWA global, Desktop ni un backend obligatorio. Las dependencias y arquitectura actuales se conservan; no se actualizó SDK por rutina.

### Pruebas ejecutadas y límites

La verificación integrada ejecutó `lint:css` → `validate:pos` → `test:pos`, `test:lan`, `test:finance`. Últimos informes locales del 2026-10-31 UTC: **69 POS, 59 LAN y 22 finanzas, todas aprobadas**. Se añadieron nueve casos de regresión en esta estabilización. TypeScript limpio; oxlint **0 errores y 22 advertencias**, sin supresiones: 17 assertions inseguras, 4 dependencias extra de efectos y 1 parámetro genérico innecesario. La matriz explica su clasificación y los límites de la comparación histórica.

No hubo ejecución aislada por filtro: no se dispone aquí de una consola para esos comandos. Se ejecutó formato en escritura (`npm run format`), pero **`npm run format:check` queda pendiente como comando separado**. El resultado del motor de lint no se presenta como salida independiente de una invocación literal `npm run lint`. En el entorno Android de aceptación ejecutar los comandos exactos listados en la matriz y registrar sus salidas.

El preview ya renderiza `/movements` a 402 pt: mostró **Acceso restringido** sin sesión. Esto descarta un bloqueo total del preview en esa captura, pero no verifica Movimientos autenticado ni ventas/caja/paneles financieros. No se alteró el diseño.

### Pendientes, riesgos y continuación

- **Android:** no APK compilado/firmado ni pruebas físicas realizadas. LAN/TLS/Keystore, Java, hotspot/Direct/NSD, cámara/OCR, cierre forzado, archivos e impresión requieren dos dispositivos y evidencia. Preparación de compilación y registro de pruebas en la matriz; no usar la única base de producción.
- **Datos/recuperación:** probar migraciones/restauración con copias reales anonimizadas v5/v6/v7; recuperación asistida de legado dañado, pin/clave perdido y réplica integral siguen pendientes. Nunca borrar ni reenviar a otra autoridad para resolver una incertidumbre. Archivo comercial JSON no cifrado; proteger datos personales y archivos v1 antiguos con hashes.
- **Empresarial offline no implementado:** negocios/sucursales aislados, traslados con recepción, personal/nómina, crédito/abonos, clientes/proveedores, multidivisa/tasas históricas, tickets configurables y exportación consolidada. Inversión actual es inventario/costos, no aportes de inversores. La matriz identifica reglas comerciales que aún no están definidas suficientemente; no se inventaron cálculos ni pantallas aparentes.
- **Punto exacto de continuación:** A30/A32 de la matriz (recuperación/conservación real), compilación y aceptación A26–A29; después A33/A34 (contexto autorizado de negocio/sucursal y recepción trazable). Mantener fuera servicios globales, sincronización internacional y Desktop independiente.
