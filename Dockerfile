# Use Node.js LTS version
FROM node:20-alpine

# Install Sharp dependencies
RUN apk add --no-cache vips-dev

WORKDIR /app

# Create data directory
RUN mkdir -p /app/data

COPY package*.json ./
RUN npm ci --only=production

# Copy bot files and commands folder
COPY bot.js ./
COPY commands ./commands/

CMD ["node", "bot.js"] 