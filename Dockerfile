FROM oven/bun:1.2.2 AS base

# I guess this is how you enable pipefail? This requires podman build with the
# --docker flag.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt update
RUN apt install -y curl wget

FROM base AS builder

RUN apt install -y build-essential python3

# For layer caching
COPY package.json bun.lock ./

RUN bun install --frozen-lockfile --no-save

# Pull in app code
#
# Temporarily chown because we have a temp table in prod and we need to be able
# to write the schema file for it
COPY --chown=1000:1000 . .

ENV NODE_ENV=production
USER bun
# Using this command format allows Docker to forward signals to our process
CMD ["bash", "-xc", "bun run --smol src/index.ts"]
