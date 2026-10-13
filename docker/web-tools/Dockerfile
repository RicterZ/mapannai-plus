FROM node:22-slim

ARG MCP_PACKAGE
RUN npm install --global "${MCP_PACKAGE}" && npm cache clean --force

USER node
