FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY README.md ./README.md

RUN npm ci

ENV TIMELINE_TRANSPORT=http
ENV TIMELINE_HTTP_HOST=0.0.0.0
ENV TIMELINE_HTTP_PORT=3000

EXPOSE 3000

CMD ["node", "dist/src/index.js"]
