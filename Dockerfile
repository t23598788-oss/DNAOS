# syntax=docker/dockerfile:1
# Next.js production image สำหรับ Cloud Run
# จุดสำคัญ: NEXT_PUBLIC_* ต้องถูกส่งเป็น BUILD ARG
#           เพราะหน้า public ถูก prerender ตอน build -> ค่าถูกฝังลง HTML

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app

# bash จำเป็นเพราะ package.json มี prebuild -> scripts/deploy-gate.ts
# ซึ่งเรียก execSync("bash scripts/governance.sh")
RUN apk add --no-cache bash

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# ---- build-time env (Next ฝังค่าตอนนี้) ----
ARG NEXT_PUBLIC_GA_ID=""
ARG NEXT_PUBLIC_LINE_OA_URL=""
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=""
ENV NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID
ENV NEXT_PUBLIC_LINE_OA_URL=$NEXT_PUBLIC_LINE_OA_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/registry ./registry

RUN chown -R nextjs:nextjs /app
USER nextjs

EXPOSE 8080
CMD ["npx", "next", "start", "-p", "8080"]
