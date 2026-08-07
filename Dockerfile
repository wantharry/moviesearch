FROM node:22-slim AS build

# better-sqlite3 compiles a native addon at install time; this stage also builds the React
# frontend (Vite + react/react-dom are devDependencies, only needed here, not at runtime).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY vite.config.mjs ./
COPY web/ ./web/
RUN npm run build


FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY --from=build /app/public/ ./public/
COPY data/movies.db ./data/movies.db

RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
