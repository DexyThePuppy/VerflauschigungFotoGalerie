# Use Node.js LTS version
FROM node:20-alpine

# Install Sharp dependencies
RUN apk add --no-cache vips-dev

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY bot.js ./

CMD ["node", "bot.js"] 