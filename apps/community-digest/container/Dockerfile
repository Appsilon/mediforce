FROM node:20-slim

WORKDIR /app

# Copy compiled gather script
COPY dist/gather-github-changes.js /app/gather-github-changes.js

# Create output directory
RUN mkdir -p /output

# No ENTRYPOINT — command specified in docker run via agentConfig.command
