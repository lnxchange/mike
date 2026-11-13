# Built from the repository root. The task pane imports
# frontend/src/shared, which sits outside this directory.
FROM node:22-slim AS build

WORKDIR /app
COPY word-addin/package.json word-addin/package-lock.json ./word-addin/
WORKDIR /app/word-addin
RUN npm ci
COPY word-addin/ ./
COPY packages/contracts /app/packages/contracts
COPY frontend/src/shared /app/frontend/src/shared
COPY frontend/public /app/frontend/public

ARG REACT_APP_WEB_APP_URL
ARG WORD_ADDIN_PUBLIC_URL
ENV REACT_APP_API_BASE_URL=/api \
    REACT_APP_WEB_APP_URL=$REACT_APP_WEB_APP_URL \
    WORD_ADDIN_PUBLIC_URL=$WORD_ADDIN_PUBLIC_URL
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/word-addin/dist ./dist
COPY word-addin/server.mjs ./server.mjs
ENV NODE_ENV=production PORT=3200
EXPOSE 3200
CMD ["node", "server.mjs"]
