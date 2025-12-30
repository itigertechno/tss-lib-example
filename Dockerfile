# Сборка go оболочки
FROM golang:1.25.5 AS wasm-builder
WORKDIR /app
COPY vendor/go ./vendor/go
WORKDIR /app/vendor/go
RUN go mod tidy
RUN GOOS=js GOARCH=wasm go build -o tss.wasm .

# Сборка фронтенда
FROM node:20-alpine AS next-builder
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm i
COPY . .
COPY --from=wasm-builder /app/vendor/go/tss.wasm ./public/tss.wasm
RUN pnpm run build

# Запуск фронтенда
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=next-builder /app/.next ./.next
COPY --from=next-builder /app/public ./public
COPY --from=next-builder /app/node_modules ./node_modules
COPY --from=next-builder /app/package.json ./package.json
COPY --from=next-builder /app/next.config.ts ./next.config.ts
EXPOSE 3000
CMD ["npm", "run", "start"]
    