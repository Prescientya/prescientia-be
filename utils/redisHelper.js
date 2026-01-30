const redisClient = require('../config/redis');

/**
 * Set value dengan optional TTL (time to live)
 * @param {string} key - Redis key
 * @param {any} value - Value to store
 * @param {number} ttl - Time to live in seconds (optional)
 */
const setCache = async (key, value, ttl = null) => {
  try {
    const jsonValue = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttl) {
      await redisClient.setEx(key, ttl, jsonValue);
    } else {
      await redisClient.set(key, jsonValue);
    }
    console.log(`✅ Cache set: ${key}`);
  } catch (error) {
    console.error(`❌ Redis SET error for key ${key}:`, error);
  }
};

/**
 * Get value dari Redis
 * @param {string} key - Redis key
 * @returns {Promise<any>}
 */
const getCache = async (key) => {
  try {
    const value = await redisClient.get(key);
    if (!value) return null;
    
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch (error) {
    console.error(`❌ Redis GET error for key ${key}:`, error);
    return null;
  }
};

/**
 * Delete key dari Redis
 * @param {string} key - Redis key
 */
const deleteCache = async (key) => {
  try {
    await redisClient.del(key);
    console.log(`✅ Cache deleted: ${key}`);
  } catch (error) {
    console.error(`❌ Redis DELETE error for key ${key}:`, error);
  }
};

/**
 * Delete multiple keys yang match pattern
 * @param {string} pattern - Pattern like 'user:*'
 */
const deleteCachePattern = async (pattern) => {
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
      console.log(`✅ Cache deleted: ${keys.length} keys matching ${pattern}`);
    }
  } catch (error) {
    console.error(`❌ Redis DELETE PATTERN error for ${pattern}:`, error);
  }
};

/**
 * Check apakah key exists
 * @param {string} key - Redis key
 */
const cacheExists = async (key) => {
  try {
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (error) {
    console.error(`❌ Redis EXISTS error for key ${key}:`, error);
    return false;
  }
};

/**
 * Get TTL dari key
 * @param {string} key - Redis key
 */
const getCacheTTL = async (key) => {
  try {
    return await redisClient.ttl(key);
  } catch (error) {
    console.error(`❌ Redis TTL error for key ${key}:`, error);
    return -1;
  }
};

/**
 * Increment counter
 * @param {string} key - Redis key
 * @param {number} increment - Amount to increment (default: 1)
 */
const incrementCounter = async (key, increment = 1) => {
  try {
    return await redisClient.incrBy(key, increment);
  } catch (error) {
    console.error(`❌ Redis INCR error for key ${key}:`, error);
    return null;
  }
};

/**
 * Decrement counter
 * @param {string} key - Redis key
 * @param {number} decrement - Amount to decrement (default: 1)
 */
const decrementCounter = async (key, decrement = 1) => {
  try {
    return await redisClient.decrBy(key, decrement);
  } catch (error) {
    console.error(`❌ Redis DECR error for key ${key}:`, error);
    return null;
  }
};

/**
 * Flush all cache
 */
const flushCache = async () => {
  try {
    await redisClient.flushDb();
    console.log('✅ All cache flushed');
  } catch (error) {
    console.error('❌ Redis FLUSH error:', error);
  }
};

module.exports = {
  setCache,
  getCache,
  deleteCache,
  deleteCachePattern,
  cacheExists,
  getCacheTTL,
  incrementCounter,
  decrementCounter,
  flushCache,
  redisClient
};
