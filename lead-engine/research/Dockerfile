FROM mcr.microsoft.com/playwright:v1.55.0-noble
WORKDIR /app
COPY research/package.json research/package-lock.json ./research/
RUN cd research && npm ci --omit=dev --ignore-scripts
COPY research/ ./research/
COPY engine/website.mjs ./engine/website.mjs
USER pwuser
WORKDIR /app/research
CMD ["node", "cli.mjs", "once"]
