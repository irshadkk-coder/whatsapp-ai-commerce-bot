# Security

- Keep secrets only in local/deployment environment variables; local environment files are ignored.
- Initial admin passwords are bcrypt-hashed; password hashes are excluded from normal queries.
- Admin APIs require a signed JWT and an active ADMIN database record.
- CORS permits the configured dashboard origin rather than wildcard authenticated access.
- Login and admin APIs are rate-limited. Webhooks are not rate-limited to avoid delivery disruption.
- The server suppresses framework identification, caps JSON request bodies at 1 MB, and sends anti-sniffing, anti-framing, and referrer headers.
- Razorpay signatures are verified against raw request bytes; WhatsApp message IDs deduplicate deliveries.
- Admin mutations use allowlists and validated status values. Internal support notes are never WhatsApp messages.
- Use MongoDB Atlas least-privilege access, TLS, network restrictions, and secret rotation.
