FROM node:20-bookworm-slim AS base
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev=false
COPY . .
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY package.json ./
EXPOSE 8080
CMD ["node", "dist/server.js"]
