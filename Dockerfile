# worker/Dockerfile
FROM docker.io/library/node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Build step
RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production
CMD ["npm", "start"]