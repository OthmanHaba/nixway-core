```bash
     $CREATE_RELEASE()

     cd $FORGE_RELEASE_DIRECTORY

     # Install deps — pnpm 10 ignores build scripts by default; don't let it abort.
     pnpm install --frozen-lockfile --no-strict-dep-builds

     # Build orbit only (its Nuxt layers are resolved automatically at build time)
     pnpm --filter @now-system/orbit build

     # Symlink Forge's site-level .env into the app so Nitro can read it at runtime
     ln -sf $FORGE_RELEASE_DIRECTORY/.env $FORGE_RELEASE_DIRECTORY/apps/orbit/.env

     $ACTIVATE_RELEASE()

     # Overwrite the PM2 config every time so we guarantee valid JSON
     mkdir -p /home/forge/.pm2-conf
     cat <<'EOF' > /home/forge/.pm2-conf/site-3219001.json
     {
         "name": "site-3219001",
         "cwd": "/home/forge/now-orbit-f14aqrgd.on-forge.com/current/apps/orbit",
         "script": "./.output/server/index.mjs",
         "instances": "max",
         "exec_mode": "cluster",
         "env": {
             "NODE_ENV": "production",
             "HOST": "0.0.0.0",
             "PORT": "3000",
             "NITRO_PORT": "3000"
         }
     }
     EOF

     # Start on first deploy, reload on every subsequent deploy
     pm2 start /home/forge/.pm2-conf/site-3219001.json 2>/dev/null || pm2 reload site-3219001 --update-env
     pm2 save
   ```
