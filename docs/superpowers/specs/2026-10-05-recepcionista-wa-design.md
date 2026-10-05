# Recepcionista WA — Diseño v1

**Fecha:** 2026-10-05
**Estado:** aprobado en conversación, pendiente de revisión escrita

## 1. Propósito

Micro-SaaS para consultorios pequeños en Perú (dentistas primero, luego estética y veterinarias) que automatiza por WhatsApp lo que hoy hace la recepcionista a mano:

- Recordatorios de cita 24 h y 2 h antes, con botones **Confirmo / Reprogramar / Cancelar**.
- Reprogramación autoservicio por WhatsApp eligiendo un horario libre.
- Recordatorios de pago con las instrucciones de pago del consultorio.
- Copia de la agenda al Google Calendar del consultorio.

**Problema que resuelve:** los pacientes faltan a sus citas sin avisar (2–3 por día en un consultorio típico) y recordarles o cobrarles es trabajo manual que se olvida.

**Criterio de éxito de la v1:** un consultorio real usa el panel a diario; los recordatorios salen desde su propio número de WhatsApp y las respuestas del paciente actualizan la agenda sin intervención humana.

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Alcance v1 | Agenda + recordatorios + reprogramación + cobros + Google Calendar + superadmin |
| Número de WhatsApp | El número propio de cada consultorio |
| Proveedor WhatsApp | 360dialog (API compatible con la Cloud API de Meta) |
| Quién paga a Meta | El dueño del SaaS, vía 360dialog; se incluye en la cuota del consultorio |
| Pagos de pacientes | Manuales: el mensaje lleva el número Yape o un link fijo; el consultorio marca "pagado" |
| Google Calendar | Un solo sentido: panel → Calendar |
| Usuarios | Varios por consultorio; roles OWNER y RECEPTION; además SUPERADMIN |
| Agenda | Una por consultorio (sin agenda por profesional) |
| Alta de consultorios | Solo el superadmin; cobro de suscripción manual con "pagado hasta" |
| Stack | Monorepo npm workspaces: NestJS + TypeORM + PostgreSQL (API), Next.js 15 + Tailwind + shadcn/ui (panel PWA) |
| Tareas programadas | Tabla `scheduled_messages` + cron cada minuto con `FOR UPDATE SKIP LOCKED`; sin Redis |

## 3. Arquitectura

```
recepcionista-wa/
├─ apps/api   NestJS: REST, webhooks, cron
├─ apps/web   Next.js 15: /admin (superadmin) y /app (consultorio), PWA
├─ docker-compose.yml   PostgreSQL 16 local
└─ docs/
```

Servicios externos: 360dialog (WhatsApp) y Google Calendar API.

### Módulos de la API (NestJS)

| Módulo | Responsabilidad |
|---|---|
| `auth` | Login, JWT en cookie httpOnly, invitaciones, guards de rol y de consultorio |
| `clinics` | Datos del consultorio, horario semanal, servicios, instrucciones de pago, ajustes de recordatorios |
| `patients` | CRUD de pacientes y consentimiento de WhatsApp |
| `appointments` | CRUD de citas, cálculo de horarios libres, transiciones de estado, historial |
| `charges` | Saldos: PENDING → PAID / CANCELLED (manual) |
| `scheduler` | Cola en `scheduled_messages`, cron de envío, cron de sincronización de Calendar, cron diario de suscripciones, cron de estado de plantillas |
| `whatsapp` | Cliente 360dialog: envío de plantillas y mensajes interactivos, webhook, onboarding, alta de plantillas |
| `conversation` | Interpretar respuestas del paciente (botones, lista, texto libre) |
| `calendar` | OAuth de Google y copia de citas a Calendar |
| `admin` | Superadmin: alta de consultorios, invitación al dueño, "pagado hasta" |

### Reglas transversales

- **Separación entre consultorios:** toda tabla del consultorio lleva `clinic_id`. Un guard toma `clinic_id` del JWT; ningún endpoint lo acepta en el cuerpo ni en la URL.
- **Secretos en la base de datos:** API keys de 360dialog y refresh tokens de Google se guardan cifrados con AES-256-GCM; la clave viene de `ENCRYPTION_KEY` en `.env`.
- **Fechas:** se guardan en UTC (`timestamptz`) y se muestran en la zona horaria del consultorio (por defecto `America/Lima`).
- **Suscripción:** si el consultorio está SUSPENDED, el scheduler no envía mensajes de ese consultorio.

## 4. Modelo de datos

Convenciones: claves `uuid`, `created_at` y `updated_at` en todas las tablas, migraciones de TypeORM.

### Consultorio y acceso

**`clinics`**
- `name`, `address`, `timezone` (por defecto `America/Lima`)
- `payment_instructions` (texto: número Yape y/o link de pago)
- `send_2h_to_confirmed` (bool, por defecto `false`)
- `subscription_status` (ACTIVE | PAST_DUE | SUSPENDED), `paid_until` (date)

**`users`**
- `email` (único), `password_hash` (nulo hasta aceptar la invitación), `name`
- `role` (SUPERADMIN | OWNER | RECEPTION), `active` (bool, por defecto `true`)
- `clinic_id` (nulo solo para SUPERADMIN)
- `invite_token_hash`, `invite_expires_at` (72 h)

**`business_hours`**
- `clinic_id`, `weekday` (0–6), `opens_at`, `closes_at` (`time`)
- Puede haber varias filas por día (por ejemplo, para el refrigerio).

**`services`**
- `clinic_id`, `name`, `duration_min`, `active`

### Operación diaria

**`patients`**
- `clinic_id`, `full_name`, `phone_e164`, `whatsapp_opt_in`, `opt_in_at`, `notes`
- Único por (`clinic_id`, `phone_e164`).

**`appointments`**
- `clinic_id`, `patient_id` y `service_id` (ambos nulos solo cuando `is_block = true`)
- `starts_at`, `ends_at`
- `status` (SCHEDULED | CONFIRMED | CANCELLED | ATTENDED | NO_SHOW)
- `is_block` (bool): bloquea un horario sin paciente, por ejemplo un feriado.
- `google_event_id`, `calendar_dirty` (bool), `created_by`
- Restricción de exclusión (extensión `btree_gist`): `EXCLUDE USING gist (clinic_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status <> 'CANCELLED')`

**`appointment_events`**
- `appointment_id`, `clinic_id`
- `type` (CREATED | UPDATED | CONFIRMED | CANCELLED | RESCHEDULED | ATTENDED | NO_SHOW)
- `source` (PANEL | WHATSAPP)
- `actor_user_id` (nulo si el origen es WhatsApp), `data` (jsonb)

**`charges`**
- `clinic_id`, `patient_id`, `appointment_id` (nulo permitido)
- `amount_cents`, `currency` (por defecto `PEN`), `concept`
- `status` (PENDING | PAID | CANCELLED), `due_date`, `paid_at`, `paid_by_user_id`

### WhatsApp y mensajería

**`whatsapp_accounts`**
- `clinic_id` (único), `phone_number`, `display_name`
- `channel_id` (360dialog), `api_key_enc`, `webhook_token` (aleatorio, único)
- `status` (PENDING | CONNECTED | ERROR), `last_error`

**`whatsapp_templates`**
- `clinic_id`, `name`, `language` (`es`)
- `status` (PENDING | APPROVED | REJECTED), `rejection_reason`

**`scheduled_messages`**
- `clinic_id`, `kind` (REMINDER_24H | REMINDER_2H | PAYMENT_REMINDER)
- `appointment_id` o `charge_id`, `send_at`
- `status` (PENDING | SENDING | SENT | FAILED | CANCELLED)
- `attempts`, `last_error`, `cancel_reason`
- Único por (`appointment_id`, `kind`) cuando `appointment_id` no es nulo.

**`messages`**
- `clinic_id`, `patient_id` (nulo si el remitente es desconocido)
- `direction` (IN | OUT), `wa_message_id` (único), `type`, `payload` (jsonb)
- `status` (SENT | DELIVERED | READ | FAILED, solo para OUT)
- `scheduled_message_id` (nulo permitido)

### Google Calendar

**`calendar_connections`**
- `clinic_id` (único), `google_email`, `refresh_token_enc`
- `calendar_id` (por defecto `primary`), `status` (CONNECTED | ERROR)

## 5. Flujos

### 5.1 Crear, editar o cancelar una cita (panel)

1. Se inserta o actualiza la cita.
   - Si choca con otra, la restricción de exclusión lanza un error y la API responde 409 con el mensaje "Horario ocupado".
2. Se programan los recordatorios en `scheduled_messages`:
   - `REMINDER_24H` con `send_at = starts_at − 24h`, solo si esa hora todavía no pasó.
   - `REMINDER_2H` con `send_at = starts_at − 2h`, solo si esa hora todavía no pasó.
3. Al editar la hora, las filas pendientes cambian de `send_at`.
4. Al cancelar, las filas pendientes pasan a CANCELLED.
5. Se marca `calendar_dirty = true` y se registra el evento en `appointment_events`.

### 5.2 Cron de envío (cada minuto)

1. Toma hasta 50 filas PENDING con `send_at <= now()` usando `FOR UPDATE SKIP LOCKED` y las pasa a SENDING.
2. Para cada fila verifica las precondiciones:
   - consultorio no SUSPENDED;
   - cuenta de WhatsApp CONNECTED y plantilla APPROVED;
   - paciente con `whatsapp_opt_in`;
   - cita en SCHEDULED o CONFIRMED (si es recordatorio de cita), o cobro en PENDING (si es de pago).

   Si alguna falla, la fila pasa a CANCELLED con `cancel_reason`.
3. `REMINDER_2H` se cancela si la cita está CONFIRMED y `send_2h_to_confirmed = false`.
4. Envía la plantilla vía 360dialog e inserta una fila OUT en `messages`. La fila pasa a SENT.
5. Si el envío falla:
   - `attempts++`, y `send_at` se mueve +5, +15 o +60 minutos (según el intento) con estado PENDING;
   - al tercer fallo pasa a FAILED, y el panel la muestra como "recordatorio no enviado".
6. Al arrancar la API, las filas que quedaron en SENDING por más de 10 minutos vuelven a PENDING.

### 5.3 Webhook de 360dialog

- **Ruta:** `POST /webhooks/wa/:webhookToken`. El token identifica al consultorio; si es desconocido, se responde 404. Tiene límite de peticiones.
- **Mensajes entrantes:** se guardan en `messages` (IN). Si el `wa_message_id` ya existe, se ignora (idempotencia).
- **Estados de entrega:** actualizan el `status` del mensaje OUT. Solo avanzan, nunca retroceden: SENT → DELIVERED → READ. FAILED se registra en cualquier momento.
- **Seguridad:** antes de actuar sobre una cita se valida que pertenezca al consultorio del webhook **y** que el teléfono del paciente coincida con el remitente.

| Payload | Acción | Respuesta al paciente |
|---|---|---|
| `CONFIRM:<citaId>` | La cita pasa a CONFIRMED y se registra el evento | "✅ ¡Confirmado! Te esperamos el {fecha} a las {hora}." |
| `CANCEL:<citaId>` | La cita pasa a CANCELLED, se cancelan sus recordatorios pendientes y se marca `calendar_dirty` | "Tu cita fue cancelada. Si quieres agendar otra, escríbenos." |
| `RESCHEDULE:<citaId>` | Se calculan los próximos horarios libres (hasta 10, en los próximos 7 días, desde mañana) | Mensaje de lista interactiva; cada fila tiene el id `PICK:<citaId>:<isoInicio>` |
| `PICK:<citaId>:<isoInicio>` | Se mueve la cita, se reprograman los recordatorios, se marca `calendar_dirty` y se registra RESCHEDULED. Si la restricción de exclusión falla, se envía una lista nueva | "📅 Listo, tu cita quedó para el {fecha} a las {hora}." |
| Texto libre | Solo se guarda. Con Coexistence, el consultorio lo ve en su app de WhatsApp | Ninguna, salvo el plan B (ver §8) |

**Cálculo de horarios libres** (función pura, con pruebas unitarias):
1. Se generan bloques del largo del servicio dentro de `business_hours`, en la zona horaria del consultorio.
2. Se descartan los bloques que se cruzan con citas no canceladas.
3. Se descartan los bloques de hoy y los que ya pasaron.

### 5.4 Recordatorio de pago

- **Enviar ahora:** desde el panel, inserta un `PAYMENT_REMINDER` con `send_at = now()`.
- **Programar:** si el cobro tiene `due_date`, inserta uno para las 10:00 hora local de ese día.
- **Plantilla `recordatorio_pago`:** nombre del paciente, concepto, monto y `payment_instructions`.
- **Marcar pagado:** solo a mano desde el panel; guarda `paid_at` y `paid_by_user_id`.

### 5.5 Alta de consultorio y conexión de WhatsApp

1. El superadmin crea el consultorio con el email del dueño. Se crea un usuario OWNER con invitación (token de un solo uso, válido 72 h) y se envía el enlace por correo.
2. El dueño fija su contraseña y configura horario, servicios e instrucciones de pago.
3. El dueño toca **"Conectar WhatsApp"**: se abre el Integrated Onboarding de 360dialog, que vuelve con `channel_id`. Entonces la API:
   1. pide a la Partner API de 360dialog una API key para ese canal;
   2. la guarda cifrada;
   3. registra el webhook `…/webhooks/wa/<webhookToken>`;
   4. crea las plantillas `recordatorio_cita_24h`, `recordatorio_cita_2h` y `recordatorio_pago` (categoría UTILITY, `es`).
4. Un cron cada 15 minutos consulta el estado de las plantillas PENDING. Cuando las tres están APPROVED, el panel muestra "Listo para enviar".

**Plantillas:**
- **`recordatorio_cita_24h`:** "Hola {{1}}, te recordamos tu cita en {{2}} el {{3}} a las {{4}}." con 3 botones de respuesta rápida. El payload de cada botón se fija al enviar.
- **`recordatorio_cita_2h`:** "{{1}}, te esperamos hoy a las {{2}} en {{3}}." con el botón Cancelar.
- **`recordatorio_pago`:** "Hola {{1}}, tienes un saldo de S/ {{2}} por {{3}}. Puedes pagar así: {{4}}."

### 5.6 Google Calendar

- **Conexión:** OAuth con el scope `https://www.googleapis.com/auth/calendar.events` y acceso offline. Se guarda el refresh token cifrado y se usa `calendar_id = primary`.
- **Cron cada minuto:** toma las citas con `calendar_dirty = true` de consultorios conectados.
  - Sin `google_event_id`: se crea el evento.
  - Con `google_event_id`: se actualiza el evento.
  - Cita cancelada: se borra el evento.

  Luego se marca `calendar_dirty = false`.
- **Título del evento:** "{paciente} — {servicio}". La descripción incluye el teléfono y el estado.
- **Errores:**
  - Error 401 o `invalid_grant`: la conexión pasa a ERROR y el panel pide "Reconectar Calendar".
  - Otros errores: la cita sigue con `calendar_dirty` y se reintenta en el próximo ciclo.

### 5.7 Suscripción

El superadmin edita `paid_until`. Un cron diario (06:00 Lima) actualiza el estado:

- `paid_until >= hoy` → ACTIVE
- `paid_until < hoy` → PAST_DUE: el panel muestra un aviso y los envíos continúan.
- `paid_until + 5 días < hoy` → SUSPENDED: se detienen los envíos.

## 6. Panel (apps/web)

### `/app` (OWNER y RECEPTION)

- **Agenda:** vista de día y de semana, estado de cada cita con color, crear, editar, cancelar, marcar asistió o no asistió, y crear bloqueos.
- **Pacientes:** lista, búsqueda, ficha con historial de citas y cobros, y casilla de consentimiento.
- **Cobros:** pendientes y pagados, "Enviar recordatorio" y "Marcar pagado".
- **Alertas:** recordatorios FAILED, WhatsApp o Calendar en ERROR, suscripción vencida.
- **Reporte mensual:** citas, confirmadas, reprogramadas por WhatsApp, canceladas, inasistencias y mensajes enviados.

### `/app/settings` (solo OWNER)

- Datos del consultorio, horario, servicios e instrucciones de pago.
- Conectar WhatsApp (estado de cuenta y plantillas) y Google Calendar.
- Usuarios: invitar RECEPTION y desactivar usuarios.

### `/admin` (SUPERADMIN)

- Lista de consultorios con estado, `paid_until` y mensajes enviados en el mes.
- Crear consultorio e invitar al dueño; editar `paid_until`.

### General

- PWA: `manifest.webmanifest` e íconos, instalable en el celular.
- Diseño mobile-first.

## 7. Errores, seguridad y pruebas

### Errores

- **360dialog:** reintentos 5 / 15 / 60 min y luego FAILED. Si la API key es inválida (401), la cuenta pasa a ERROR.
- **Filtro global de excepciones:** formato `{ statusCode, message, error }`, con mensajes en español.

### Seguridad

- bcrypt para contraseñas; JWT en cookie httpOnly + SameSite=Lax (y Secure en producción).
- Límite de peticiones (`@nestjs/throttler`) en login, aceptación de invitación y webhook.
- Guard de consultorio, más un test e2e que comprueba que el consultorio A no puede leer ni modificar datos de B.
- Cifrado AES-256-GCM de secretos y validación con class-validator; teléfonos con libphonenumber-js en formato E.164.
- Datos de salud (Ley 29733): datos mínimos, consentimiento con fecha, y el superadmin no accede a pacientes ni a notas.

### Pruebas (Jest)

- **Unitarias:** horarios libres, programación de recordatorios, conversación (payloads), cifrado y transiciones de suscripción.
- **E2E de la API:** contra PostgreSQL en Docker (restricción de exclusión y `SKIP LOCKED` reales), con 360dialog y Google simulados.
- **Prueba manual de punta a punta:** con el sandbox de 360dialog y un celular real.

## 8. Riesgos por verificar antes de la etapa 4

1. **Coexistence con 360dialog.** Confirmar que 360dialog permite que el consultorio siga usando la app WhatsApp Business con el mismo número. **Plan B:** número dedicado del consultorio solo para la API, con respuesta automática al texto libre: "Este número envía recordatorios; para consultas comunícate al {teléfono}".
2. **Cuenta Partner de 360dialog.** Requisitos, cuota mensual por número y forma de facturar el uso de Meta.
3. **Tarifas vigentes de Meta para Perú** (utility y service), para fijar los precios de los planes.

## 9. Fuera de alcance de la v1

Agenda por profesional, sincronización Calendar → panel, integración con Mercado Pago o Yape, registro abierto y cobro automático de la suscripción, bandeja de chat en el panel, IA conversacional, app nativa, tabla de feriados (se cubre con bloqueos) y SMS o correo como respaldo.

## 10. Orden de construcción

1. Monorepo, Docker, auth, roles, superadmin y alta de consultorio con invitación.
2. Pacientes, servicios, horario, citas con restricción de exclusión y agenda en el panel.
3. Scheduler, cliente 360dialog (sandbox), webhook y conversación (confirmar, cancelar, reprogramar).
4. Onboarding de WhatsApp por consultorio y plantillas.
5. Cobros y recordatorio de pago.
6. Google Calendar.
7. Suscripción, reporte mensual, PWA y despliegue (Vercel + Railway).
