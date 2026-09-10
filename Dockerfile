FROM node:24-alpine

WORKDIR /app

COPY package.json ./

RUN npm install --omit=dev

COPY src ./src

RUN mkdir -p /var/lib/openvarde \
    && chown -R node:node /var/lib/openvarde /app

USER node

EXPOSE 8081

CMD ["npm", "start"]