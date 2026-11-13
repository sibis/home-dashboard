FROM node:22-bookworm-slim

# Chromium renders the dashboard to an image. Debian's package works on both x86 and ARM NAS devices.
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Use the system Chromium instead of downloading one during npm install
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    DATA_DIR=/app/data

WORKDIR /app

COPY package.json package-lock.json ./
# pm2 is only needed outside Docker, Docker restarts the container instead
RUN npm ci --omit=dev

COPY . .

# data/ holds state, tasks and Google tokens: mount it as a volume
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 7272

HEALTHCHECK --interval=60s --timeout=10s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7272)+'/tasks').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
