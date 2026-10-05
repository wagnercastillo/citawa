# Recepcionista WA

Recordatorios de citas por WhatsApp para consultorios pequeños. Spec: `docs/superpowers/specs/2026-10-05-recepcionista-wa-design.md`.

## Levantar en local

```bash
cp .env.example .env          # editar JWT_SECRET y SUPERADMIN_*
npm install
npm run db:up                 # PostgreSQL en localhost:5433
npm run migration:run -w apps/api
npm run seed:superadmin -w apps/api
npm run dev                   # API :4000 + panel :3000
```

## Tests

```bash
npm run test:api              # unit + e2e (usa la base recepcionista_test)
```
