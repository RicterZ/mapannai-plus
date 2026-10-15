FROM node:22-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

ARG NEXT_PUBLIC_IMAGE_DOMAINS

ENV NEXT_PUBLIC_IMAGE_DOMAINS=$NEXT_PUBLIC_IMAGE_DOMAINS

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build
RUN node --input-type=module -e "import { build } from 'esbuild'; await build({entryPoints:['src/agent/main.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:'dist/agent.cjs'})"
RUN npm prune --omit=dev

FROM node:22-slim AS runner

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

WORKDIR /app

RUN npm install --global @brave/brave-search-mcp-server@2.1.4 firecrawl-mcp@3.29.1 && npm cache clean --force
ENV BRAVE_MCP_TRANSPORT=stdio
ENV BRAVE_MCP_ENABLED_TOOLS=brave_web_search
ENV HTTP_STREAMABLE_SERVER=false

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist/agent.cjs ./agent.cjs
COPY scripts/start-services.cjs ./start-services.cjs
COPY --from=builder /app/.next/static ./.next/static

RUN mkdir -p ./public
COPY --from=builder /app/public/ ./public/

RUN mkdir -p /app/data && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

ENV NODE_ENV production
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "Promise.all([fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/'),fetch('http://127.0.0.1:'+(process.env.AGENT_PORT||3100)+'/health')]).then(rs=>process.exit(rs.every(r=>r.ok)?0:1)).catch(()=>process.exit(1))"

CMD ["node", "start-services.cjs"]
