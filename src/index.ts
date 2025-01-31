import { Hono } from 'hono'

interface CacheEntry {
  content: string;
  contentType: string;
  timestamp: number;
}

const parseCacheDuration = (response: string): number => {
  // Uncomment to see the reasoning output from the AI
  console.log(response);
  const cleanResponse = response.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  const words = cleanResponse.split(/\s+/);
  const lastWord = words[words.length - 1];
  const cacheDuration = /^\d+$/.test(lastWord) ? parseInt(lastWord) : 3600;
  return cacheDuration;
}

const app = new Hono<{ Bindings: CloudflareBindings }>()

app.get('*', async (c) => {
  const url = new URL(c.req.url);
  const cacheKey = url.pathname;

  const cached = await c.env.CACHE.get(cacheKey);
  if (cached) {
    try {
      const cacheEntry: CacheEntry = JSON.parse(cached);
      return new Response(cacheEntry.content, {
        headers: {
          'Content-Type': cacheEntry.contentType
        }
      });
    } catch (e) {
      return new Response(cached);
    }
  }

  const originHost = c.env.ORIGIN;
  const originUrl = new URL(originHost + url.pathname);
  const response = await fetch(originUrl.toString());
  const content = await response.text();
  const contentType = response.headers.get('Content-Type') || 'text/plain';

  const analysis = await c.env.AI.run('@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', {
    messages: [{
      role: 'user',
      content: `Analyze this content and recommend a cache duration in seconds. 
        Consider: 
        - Content type (${contentType})
        - Time sensitivity
        - Update frequency
        Response format: Just the number in seconds.
        Content: ${content.substring(0, 1000)}`
    }]
  });

  // Default 1 hour
  const cacheDuration = parseCacheDuration(analysis.response);
  console.log(`Cache duration generated for ${url.pathname}: ${cacheDuration} seconds`);

  const cacheEntry: CacheEntry = {
    content,
    contentType,
    timestamp: Date.now()
  };

  // Store in cache
  await c.env.CACHE.put(cacheKey, JSON.stringify(cacheEntry), {
    expirationTtl: cacheDuration
  });

  return new Response(content, {
    headers: {
      'Content-Type': contentType
    }
  });
})

export default app
