# API Server
FROM node:22-alpine
WORKDIR /workspace/docker/api-server
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
CMD ["npm","run","dev"]
