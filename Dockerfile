FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
# CEO Constitution + Chat Handoff — required by server.js auto-load (CEO directive 22 May)
COPY 00_CEO_CONSTITUTION.md ./00_CEO_CONSTITUTION.md
COPY CHAT_HANDOFF.md ./CHAT_HANDOFF.md
EXPOSE 8080
CMD ["node", "server.js"]
