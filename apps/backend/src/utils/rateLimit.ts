interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Tope de claves simultáneas para que el mapa no crezca sin control. */
  maxKeys?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Limitador de ventana fija en memoria.
 *
 * Es suficiente para una única instancia del backend, que es el escenario actual.
 * Si algún día se despliegan varias instancias, hay que sustituir el mapa por un
 * almacén compartido (por ejemplo Redis) para que el límite sea global.
 */
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs: number;
  private readonly max: number;
  private readonly maxKeys: number;

  constructor(options: RateLimitOptions) {
    this.windowMs = options.windowMs;
    this.max = options.max;
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  /** Número de ventanas activas; útil para observabilidad y para los tests. */
  get size() {
    return this.buckets.size;
  }

  check(key: string, now = Date.now()): RateLimitResult {
    this.pruneExpired(now);

    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.ensureCapacity(key);
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.max - 1, retryAfterSeconds: 0 };
    }

    if (bucket.count >= this.max) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      };
    }

    bucket.count += 1;
    return { allowed: true, remaining: this.max - bucket.count, retryAfterSeconds: 0 };
  }

  private pruneExpired(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }

  /** Libera hueco antes de insertar una clave nueva, descartando las más antiguas. */
  private ensureCapacity(incomingKey: string) {
    while (this.buckets.size >= this.maxKeys && !this.buckets.has(incomingKey)) {
      const oldest = this.buckets.keys().next();
      if (oldest.done) {
        return;
      }
      this.buckets.delete(oldest.value);
    }
  }
}
