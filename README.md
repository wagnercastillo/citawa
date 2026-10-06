# Recepcionista WA

Recordatorios de citas por WhatsApp para consultorios pequeños. Spec: `docs/superpowers/specs/2026-10-05-recepcionista-wa-design.md`.

## Levantar en local

```bash
cp .env.example .env          # editar JWT_SECRET y SUPERADMIN_*
npm install
npm run db:up                 # PostgreSQL en localhost:5434
npm run migration:run -w apps/api
npm run seed:superadmin -w apps/api
npm run dev                   # API :4000 + panel :3000
```

## Tests

```bash
npm run test:api              # unit + e2e (usa la base recepcionista_test)
```

## Probar WhatsApp (Etapa 3)

1. **Exponer la API con HTTPS** (360dialog exige HTTPS sin puerto):
   ```bash
   npx cloudflared tunnel --url http://localhost:4000
   ```
   Poner la URL que imprime en `PUBLIC_API_URL` de `.env` y reiniciar la API.
2. **Sandbox (solo tu número, máximo 200 mensajes):**
   - Desde tu WhatsApp, enviar `START` a +55 11 4673-3492; la respuesta trae la API key.
   - En `/admin` → WhatsApp del consultorio: pegar la key, tu número y marcar "Sandbox".
   - Crear un paciente con **tu** número y con consentimiento, y una cita para dentro de algo más de 24 h.
   - Para no esperar, adelantar el envío en la base de datos:
     ```sql
     UPDATE scheduled_messages SET send_at = now() WHERE kind = 'REMINDER_24H';
     ```
     En menos de un minuto llega la plantilla de prueba con los botones Confirm/Cancel; al tocarlos, la agenda cambia.
3. **Producción (conexión manual del superadmin):** desde la Etapa 4 las plantillas se crean solas al conectar. Como referencia, son estas (en el panel de 360dialog (categoría UTILITY, idioma es) estas plantillas:
   - `recordatorio_cita_24h`: "Hola {{1}}, te recordamos tu cita en {{2}} el {{3}} a las {{4}}." con 3 botones de respuesta rápida: Confirmo, Reprogramar, Cancelar.
   - `recordatorio_cita_2h`: "{{1}}, te esperamos hoy a las {{2}} en {{3}}." con 1 botón: Cancelar.

## Conectar WhatsApp por consultorio (Etapa 4)

1. **Credenciales del partner:** en el Partner Hub de 360dialog, obtener el Partner ID y generar una API key (sección API Keys). Ponerlos en `.env`:
   - `D360_PARTNER_ID=…`
   - `D360_PARTNER_API_KEY=…`

   Elegir **Partner Payment** (tú pagas 360dialog y Meta).
2. **Redirect URL:** en el Partner Hub, configurar como redirect URL `${WEB_URL}/app/settings/whatsapp/callback`.
3. **Conectar:** el dueño entra a **Configuración → WhatsApp → Conectar WhatsApp**, completa el popup y vuelve. Las 3 plantillas se crean solas y su estado se actualiza cada 15 min. Cuando están aprobadas, aparece "Listo para enviar".
4. **Si falla la key del canal:** si 360dialog responde que el canal no está listo ("not running"), esperar unos minutos y reconectar.
