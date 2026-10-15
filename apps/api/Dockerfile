FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/api-contracts/package.json packages/api-contracts/package.json
RUN npm ci --workspace apps/api --workspace packages/api-contracts --include-workspace-root=false

FROM deps AS build
COPY apps/api apps/api
COPY packages/api-contracts packages/api-contracts
RUN npm --workspace packages/api-contracts run build \
  && npm --workspace apps/api run build \
  && ./node_modules/.bin/esbuild apps/api/src/tools/importProviderOperationalUsage.ts \
    --bundle --platform=node --format=esm --target=node22 \
    --outfile=apps/api/dist/tools/importProviderOperationalUsage.bundle.mjs \
  && node --check apps/api/dist/tools/importProviderOperationalUsage.bundle.mjs

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/api-contracts/package.json packages/api-contracts/package.json
RUN npm ci --workspace apps/api --workspace packages/api-contracts --include-workspace-root=false --omit=dev
COPY --from=build /app/packages/api-contracts/dist packages/api-contracts/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
# 以非 root 运行：本地存储目录预先创建并交给 node 用户，compose 挂载命名卷时会继承该属主。
RUN mkdir -p /app/storage && chown -R node:node /app
USER node
EXPOSE 4300
CMD ["npm", "--workspace", "apps/api", "run", "start"]
