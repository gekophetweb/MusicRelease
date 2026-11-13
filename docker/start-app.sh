#!/bin/sh
# Applies database migrations, then starts the website.
set -e
cd /migrate
./node_modules/.bin/prisma migrate deploy
cd /app
exec node server.js
