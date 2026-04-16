/**
 * Redis 客户端封装（可选依赖）
 * 主要作用：为 JWT 黑名单、缓存等提供 Redis 连接；不可用时降级不影响主流程。
 * 主要功能：懒加载建连；连接失败退避重试；导出 getRedisClient / 内存 fallback cache 接口。
 */
const { createClient } = require('redis');
require('dotenv').config();

let redisClient = null;
let redisUnavailable = false;        // 标记 Redis 不可用，避免重复重连
let redisRetryAt = 0;                // 下次重试时间戳（30秒重试一次）
const REDIS_RETRY_INTERVAL = 30000;  // 30秒
const memoryCache = new Map();       // Redis 不可用时的进程内 fallback

function setMemoryValue(key, value, ttlSeconds) {
  const expiresAt = Date.now() + Math.max(1, ttlSeconds) * 1000;
  memoryCache.set(key, { value, expiresAt });
}

function getMemoryValue(key) {
  const hit = memoryCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return hit.value;
}

function deleteMemoryValue(key) {
  memoryCache.delete(key);
}

async function getRedisClient() {
  if (redisClient && redisClient.isOpen) return redisClient;

  // Redis 已知不可用时，按重试间隔决定是否再次尝试
  if (redisUnavailable && Date.now() < redisRetryAt) {
    return null;
  }

  redisUnavailable = false;

  const client = createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      connectTimeout: 2000,   // 2秒连接超时，避免阻塞请求
      reconnectStrategy: false, // 禁用自动重连（由本模块统一控制）
    },
    password: process.env.REDIS_PASSWORD || undefined,
  });

  client.on('error', (err) => {
    if (!redisUnavailable) {
      console.warn('[Redis] 连接不可用（降级运行，无黑名单校验）：', err.code || err.message);
    }
    redisUnavailable = true;
    redisRetryAt = Date.now() + REDIS_RETRY_INTERVAL;
    redisClient = null;
  });

  client.on('connect', () => {
    console.log('[Redis] 连接成功');
    redisUnavailable = false;
  });

  try {
    await client.connect();
    redisClient = client;
  } catch (err) {
    console.warn('[Redis] 无法连接Redis，降级运行（无JWT黑名单校验）：', err.message);
    redisUnavailable = true;
    redisRetryAt = Date.now() + REDIS_RETRY_INTERVAL;
    redisClient = null;
  }

  return redisClient;
}

// Redis操作封装（降级处理：Redis不可用时静默失败）
const cache = {
  async set(key, value, ttlSeconds = 3600) {
    try {
      const client = await getRedisClient();
      if (!client) {
        setMemoryValue(key, value, ttlSeconds);
        return false;
      }
      await client.setEx(key, ttlSeconds, JSON.stringify(value));
      deleteMemoryValue(key);
      return true;
    } catch {
      setMemoryValue(key, value, ttlSeconds);
      return false;
    }
  },

  async get(key) {
    try {
      const client = await getRedisClient();
      if (!client) return getMemoryValue(key);
      const val = await client.get(key);
      if (val) return JSON.parse(val);
      return getMemoryValue(key);
    } catch {
      return getMemoryValue(key);
    }
  },

  async del(key) {
    try {
      const client = await getRedisClient();
      if (!client) {
        deleteMemoryValue(key);
        return false;
      }
      await client.del(key);
      deleteMemoryValue(key);
      return true;
    } catch {
      deleteMemoryValue(key);
      return false;
    }
  },

  // 黑名单JWT（退出登录用）
  async blacklistToken(token, ttlSeconds = 43200) {
    return this.set(`blacklist:${token}`, 1, ttlSeconds);
  },

  async isBlacklisted(token) {
    const val = await this.get(`blacklist:${token}`);
    return val !== null;
  },
};

module.exports = { getRedisClient, cache };
