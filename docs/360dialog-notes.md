# 360dialog — notas verificadas (2026-10-06)

Fuentes: docs.360dialog.com (messaging-api/api-reference/messages, get-started/sandbox, messaging-api/api-reference/webhooks, messaging/webhook/webhook-reference).

## Envío
- **Header:** `D360-API-KEY: <key>` + `Content-Type: application/json`.
- **Producción:** `POST https://waba-v2.360dialog.io/messages` (formato Cloud API, `messaging_product: "whatsapp"`).
- **Sandbox:** `POST https://waba-sandbox.360dialog.io/v1/messages`.
- **Respuesta:** el id del mensaje viene en `messages[0].id`. Producción responde 200 y sandbox 201.
- **Plantilla con botones de respuesta rápida:** `components: [{type:"body", parameters:[{type:"text", text}]}, {type:"button", sub_type:"quick_reply", index:"0", parameters:[{type:"payload", payload:"..."}]}]`.
- **Lista interactiva:** `interactive.type = "list"`, con máximo 10 filas, título de fila de 24 caracteres, descripción de 72 y botón de 20 (límites de Meta, sin verificar en 360dialog). Solo funciona dentro de la ventana de 24 h.

## Sandbox
- **Obtener la key:** escribir `START` por WhatsApp a +551146733492; la key llega en la respuesta.
- **Destinatarios:** solo el número que pidió la key.
- **Límite:** 200 mensajes en total; luego responde 429.
- **Plantillas:** solo `disclaimer`, `first_welcome_messsage` e `interactive_template_sandbox` (esta última con 2 quick-reply). No se pueden crear plantillas propias.
- **Sin verificar:**
  - si acepta mensajes interactivos libres (lista o botones);
  - el idioma de la plantilla de sandbox (se asume `en`);
  - el formato del webhook en sandbox.

## Webhook
- **Registro:** `POST {host}/v1/configs/webhook` con body `{ "url": "...", "headers": {...opcional} }`; responde 201.
- **Seguridad:** sin firma HMAC. Se usa un token secreto en la ruta (y opcionalmente headers propios).
- **Requisitos de la URL:** HTTPS válido, sin `_` en el host, sin puerto explícito. Hay que responder 200 en menos de 5 s.
- **Formato:**
  - Producción usa el formato Cloud: `entry[].changes[].value.{messages[], statuses[]}`.
  - El formato v1 antiguo trae los arrays en el nivel raíz. **Hay que aceptar los dos.**
  - Click en un botón de plantilla: `type:"button"`, `button.payload`.
  - Lista: `type:"interactive"`, `interactive.list_reply.id`.
  - Botón interactivo: `interactive.button_reply.id`.
  - Estados: `statuses[].{id, status: sent|delivered|read|failed}`.

## Errores
- 400, 401, 429 (también límite del sandbox), 500 y 503. El código 130429 indica límite de throughput.
- El formato del cuerpo del error no está verificado; se lee `error.message` si existe.

## Partner API / onboarding (verificado 2026-10-06; fuente principal: docs.360dialog.com/partner/llms-full.txt)
- **Partner API:** base `https://hub.360dialog.io/api/v2`, header `x-api-key: <PARTNER_API_KEY>` (se genera en el Partner Hub). El flujo Bearer queda obsoleto en 2027.
- **Popup de onboarding:** `https://app.360dialog.com/dashboard/app/{partner_id}/permissions?redirect_url=<enc>&state=<opaco>`. Parámetros opcionales: `email`, `name`, `number`, `next`, `lang`. Al volver, la redirect URL trae `?client=<id>&channels=[<channel_id>,...]` y el `state`.
- **API key de cada canal:** `POST /partners/{partner_id}/channels/{channel_id}/api_keys` (cuerpo vacío) responde `{id, address, api_key, app_id}`. Solo se puede leer una vez. ⚠️ La guía muestra otra ruta (`/partners/channels/{id}/api-keys`), sin verificar. Esperar a que el canal esté `running`. Regenerar la key borra el webhook del número.
- **Plantillas** (con la key del canal):
  - Crear: `POST https://waba-v2.360dialog.io/v1/configs/templates` con `{name, category:"UTILITY", language:"es", components:[{type:"BODY", text, example:{body_text:[[...]]}}, {type:"BUTTONS", buttons:[{type:"QUICK_REPLY", text}]}]}`.
  - Listar: `GET /v1/configs/templates`.
  - Estados: pending, approved, rejected (con `rejected_reason`), paused, disabled… Normalizar mayúsculas y minúsculas; la respuesta de creación trae `"submitted"`.
  - Si Meta reclasifica la categoría, la plantilla se rechaza.
- **Coexistence:** no tiene parámetro. El usuario elige "Yes, this number is connected to the WhatsApp Business App" dentro del popup. Requisitos: abrir la app al menos cada 13 días y no tener badge azul.
- **Facturación:**
  - *Partner Payment:* el partner paga a 360dialog y a Meta.
  - *Direct Payment:* el cliente paga a 360dialog directamente.
