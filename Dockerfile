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

# Create data directory and set permissions
RUN mkdir -p /app/data && \
    chown -R node:node /app && \
    chmod 777 /app/data  # Make data directory writable by all

# Use non-root user
USER node

CMD ["node", "bot.js"] 