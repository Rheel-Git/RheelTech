# Production careers gateway

The Cloudflare Worker `rheeltech-careers-gateway-production` handles public careers application and contact submissions for the production Supabase project.

Its production `ALLOWED_ORIGINS` value must include each exact browser origin that serves the site. The current production site is hosted on GitHub Pages, so the value is:

```text
https://rheeltech.ng,https://rheel-git.github.io
```

The GitHub Pages entry is an origin only; do not append the repository path. Keep the custom-domain origin so the same gateway also accepts the site when served from `rheeltech.ng`. Update the Cloudflare Worker production variable when the public hosting origin changes. Do not add preview or staging origins to this production allowlist.
