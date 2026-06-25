# Stage 1: Build
FROM node:20-slim AS builder

# Install build tools
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
COPY patch-lightswind.js ./

# Skip downloading heavy Chromium binary in Stage 1 build
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Force a fresh install for the current platform
RUN npm install

COPY . .
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

ENV NODE_OPTIONS="--max-old-space-size=1024"
RUN npm run build

# Stage 2: Runtime
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install chromium and its dependencies for Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    chromium \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libxshmfence1 \
    libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV HOME=/tmp



COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Create nextjs user and group
RUN addgroup --system nextjs && adduser --system --ingroup nextjs nextjs

# Fix ownership of /app directory for the nextjs user
RUN chown -R nextjs:nextjs /app

EXPOSE 3000

USER nextjs

CMD ["node", "server.js"]
