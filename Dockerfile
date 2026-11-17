# Сборка интерфейса
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Рабочий образ: только сервер, его зависимости и собранный интерфейс
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/web/dist ./web/dist
VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.js"]
