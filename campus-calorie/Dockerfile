FROM node:18-slim

# better-sqlite3 需要编译工具，Debian 系用 apt 速度快于 Alpine apk
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先复制 package 文件，利用 Docker 缓存层
COPY package.json package-lock.json ./
RUN npm ci --production

# 复制应用代码和静态资源
COPY server.js ./
COPY public ./public

# 数据库通过 volume 挂载到 data/ 目录，不打包进镜像

EXPOSE 3000

CMD ["node", "server.js"]
