# Stage 1: build the static files with Node.js. This stage is thrown away after the build.
FROM node:24-alpine AS build
WORKDIR /app

# Install dependencies first, so Docker reuses this layer until package files change
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: serve only the built files with Caddy. No Node.js in the final image.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80
