import { redis } from "../events/redis";

const LUA = `
local key = KEYS[1]
local rate = tonumber(ARGV[1])       -- tokens per second
local capacity = tonumber(ARGV[2])   -- burst size

local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, now - ts)
tokens = math.min(capacity, tokens + elapsed * rate / 1000)

local allowed = 0
local retry = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry = math.ceil((1 - tokens) * 1000 / rate)
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, math.ceil(capacity / rate * 1000) + 60000)
return { allowed, retry }
`;

redis.defineCommand("takeToken", { numberOfKeys: 1, lua: LUA });

type TakeToken = (key: string, rate: number, capacity: number) => Promise<[number, number]>;
const takeTokenCmd = (redis as unknown as { takeToken: TakeToken }).takeToken.bind(redis);

export interface TokenResult {
  allowed: boolean;
  retryAfterMs: number;
}

export async function takeToken(key: string, ratePerSec: number, burst: number): Promise<TokenResult> {
  const [allowed, retry] = await takeTokenCmd(key, ratePerSec, burst);
  return { allowed: allowed === 1, retryAfterMs: retry };
}