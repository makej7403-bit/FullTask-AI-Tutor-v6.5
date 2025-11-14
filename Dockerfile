FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

# FIX: Use npm install instead of npm ci
RUN npm install --omit=dev

COPY . .

RUN mkdir -p uploads public

EXPOSE 10000

CMD ["node", "server.js"]
