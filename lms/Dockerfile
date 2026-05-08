FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY public ./public
COPY flag.txt ./flag.txt
ENV PORT=3000
CMD ["npm", "start"]
