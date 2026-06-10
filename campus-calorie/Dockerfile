FROM node:18-alpine

# better-sqlite3 需要编译工具
RUN apk add --no-cache python3 make g++

WORKDIR /app

# 先复制 package 文件，利用 Docker 缓存层
COPY package.json package-lock.json ./
RUN npm ci --production

# 复制应用代码和静态资源
COPY server.js ./
COPY public ./public

# 数据库文件通过 volume 挂载，不打包进镜像
# 但本地运行时需要数据库存在，首次运行会自动创建

EXPOSE 3000

CMD ["node", "server.js"]