# Deploy Render

1. Commit source, package.json, package-lock.json and render.yaml to a GitHub repository. Do not commit .env, data/, node_modules/ or backups.
2. In Render choose New > Blueprint, connect the repository, then review and create the service. The Blueprint uses a paid 0.5c-512mb web service and a 1 GB persistent disk; review the current price before creating it.
3. Render installs with npm ci, starts with npm start, generates JWT_SECRET and checks /health. Node 24 is configured. No manual PORT value is needed.
4. When Live, open https://YOUR-SERVICE.onrender.com/docs. Register, login, copy accessToken into Authorize, then call /auth/me.

SQLite lives at /var/data/auth.sqlite on the persistent disk. Local accounts are not uploaded; register new accounts on the deployed API. Keep JWT_SECRET stable across deploys. Access tokens last 15 minutes; logout revokes refresh tokens only. Swagger uses CDN assets and requires Internet.

For manual Web Service setup, use the same values in render.yaml and attach a disk at /var/data. Set DATABASE_PATH=/var/data/auth.sqlite. Do not deploy SQLite on ephemeral storage if accounts must persist.

This setup uses one service instance. The app's rate limit uses the direct connection IP; for public production traffic configure rate limiting at a trusted proxy and backups for SQLite. The API assumes same-origin clients; a separate frontend domain needs explicit CORS/cookie configuration.

Reference: https://render.com/docs/blueprint-spec and https://render.com/docs/disks

