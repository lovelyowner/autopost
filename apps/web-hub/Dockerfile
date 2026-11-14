FROM node:22-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY package.json tsconfig.base.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY apps/node-api-worker ./apps/node-api-worker
COPY apps/web-hub ./apps/web-hub
RUN npm install --workspaces --if-present && \
    npm --workspace=@polypost/web-hub run build

EXPOSE 3000
CMD ["npm", "--workspace=@polypost/web-hub", "run", "start"]
