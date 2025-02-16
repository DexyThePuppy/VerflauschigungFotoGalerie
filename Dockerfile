# Use Node.js LTS version
FROM node:20-alpine

# Install Sharp dependencies and git (needed for some npm packages)
RUN apk add --no-cache vips-dev git

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with legacy peer deps (helps with compatibility)
RUN npm install --legacy-peer-deps

# Copy bot files and commands folder
COPY bot.js ./
COPY commands ./commands/
COPY image-list.json ./data/image-list.json

# Create data directory with proper permissions
RUN mkdir -p /app/data && \
    chown -R 1000:1000 /app && \
    chmod -R 755 /app && \
    chmod 777 /app/data

# Switch to non-root user with explicit UID
USER 1000:1000

CMD ["node", "bot.js"] 