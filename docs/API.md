# API

All `/api/admin` routes except `POST /api/admin/login` require `Authorization: Bearer <JWT>`.

## Authentication

- `POST /api/admin/login`
- `GET /api/admin/me`

## Management

- Orders: `GET /orders`, `GET /orders/:id`, `PATCH /orders/:id/status`. Status changes enforce `PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED`, with cancellation allowed only from PENDING, CONFIRMED, or PROCESSING. Shipping accepts optional `carrier`, `trackingNumber`, and `estimatedDeliveryDate` (`YYYY-MM-DD`).
- Products: `GET /products`, `GET /products/:id`, `POST /products`, `PATCH /products/:id`, `DELETE /products/:id`
- Customers: `GET /customers`, `GET /customers/:id`
- Conversations: `GET /conversations`, `GET /conversations/:id`, `PATCH /conversations/:id/status`

## Reporting and support

- `GET /api/admin/analytics?range=30d` or `?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/admin/support/stats`
- `GET /api/admin/support/conversations`
- `GET /api/admin/support/conversations/:id`
- `PATCH /api/admin/support/conversations/:id/status`
- `POST /api/admin/support/conversations/:id/notes`

`GET /health` is public and exposes only application/database readiness. Webhooks are not admin routes.
