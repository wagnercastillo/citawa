# Handoff — estado del proyecto

_Actualizado: 2026-10-06_

## Dónde estamos
- **Etapa 1 (base): completada e integrada a `main`.** Incluye auth con cookie, roles, superadmin con alta de consultorios e invitaciones (el enlace se copia a mano, sin correo todavía), gestión de recepcionistas y rate limit por IP real (`TRUST_PROXY`). Pasan los 34 tests.
- **Etapa 2 (agenda): completada e integrada a `main`.** Incluye configuración (datos, horario, servicios), pacientes con teléfono E.164 y consentimiento, agenda de día y semana con citas y bloqueos, exclusion constraint contra cruces, historial de eventos y escrituras condicionadas al estado leído (409 si cambió). Pasan los 88 tests.
- **Etapa 3 (WhatsApp): completada.** Incluye:
  - Recordatorios de 24 h y 2 h programados con cada cambio de cita.
  - Cron cada minuto con `SKIP LOCKED` y reintentos.
  - Cliente de 360dialog, que admite sandbox.
  - Conexión manual del superadmin, con la key cifrada.
  - Webhook idempotente con Confirmar, Cancelar y Reprogramar (lista de horarios libres).

  Cómo probarla: ver la sección "Probar WhatsApp" del README.
  - **Siguiente paso:** ver Etapa 4.
- **Etapa 4 (onboarding): completada.** El dueño conecta su número con el popup de 360dialog, las plantillas se crean solas, un poller las sigue cada 15 min y el despachador solo envía con plantillas aprobadas.
  - **Siguiente paso:** Plan 5 (cobros y recordatorio de pago).
- **Etapas 5 a 7: pendientes.** Ver §10 del spec `docs/superpowers/specs/2026-10-05-recepcionista-wa-design.md`.

## Cómo levantar
```bash
docker compose up -d                    # PostgreSQL en :5434 (dev + test)
npm install
npm run migration:run -w @recep/api
npm run seed:superadmin -w @recep/api   # usa SUPERADMIN_* de .env
npm run dev                             # API :4000 + panel :3000
npm run test:api                        # unit + e2e
```

## Lecciones (evitan tropiezos)
- **Versiones fijadas:** TypeScript 5, TypeORM 0.3, Nest 11, `@nestjs/config` 4, `@nestjs/jwt` 11, `@nestjs/typeorm` 11, `dotenv` 16, `class-validator` 0.14. Instalar sin versión trae majors incompatibles.
- **Comandos npm:** usar `-w @recep/api` / `-w @recep/web`. En Windows, la forma `-w apps/api` saltó una instalación sin avisar.
- **Archivos JSON:** escribirlos con el editor o la herramienta de archivos, no con heredoc de bash, que corrompe los `\\`.
- **Prueba en navegador pendiente:** la UI de la Etapa 1 se verificó solo por HTTP porque la extensión de Chrome no estaba conectada. Falta recorrerla con clics una vez.

## Detalles menores pendientes (revisión de la Etapa 2)
- **Panel:** algunas pantallas se quedan en "Cargando…" si falla una petición, y un error viejo de la agenda no se borra al navegar.
- **Datos:** el nombre del consultorio acepta solo espacios.
- **Bloqueos:** no pueden terminar a las 24:00.
- **Agenda:** el rango máximo real es de 32 días, no de 31.
- **Puerto:** PostgreSQL de este proyecto usa **:5434**, porque Evalia ocupa el 5433.

## Detalles menores pendientes (revisión de la Etapa 1)
- **Invitaciones:** dos aceptaciones simultáneas de la misma invitación pueden pasar las dos.
- **Login:**
  - El tiempo de respuesta revela si un email existe.
  - bcrypt solo usa los primeros 72 bytes de la contraseña; la validación de 8–72 cuenta caracteres, no bytes.
  - En producción se acepta el `JWT_SECRET` de ejemplo.
- **Panel:**
  - `useMe` se queda en "Cargando…" si la API devuelve un error distinto de 401.
  - El botón "Copiar" de la página de usuarios no confirma que copió.
- **Seed:** `seed:superadmin` convierte en superadmin a un OWNER que tenga ese mismo email.

## Para retomar en una sesión nueva
> Lee `docs/HANDOFF.md` del repo recepcionista-wa y escribe el Plan 5 (Etapa 5: cobros y recordatorio de pago) con superpowers:writing-plans.
