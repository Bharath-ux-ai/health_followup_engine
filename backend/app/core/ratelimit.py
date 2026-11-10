"""Small in-process sliding-window rate limiter (per key). For multi-instance deployments put a shared limiter
(e.g. at the reverse proxy) in front as well."""
import threading
import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, limit: int, window_seconds: int):
        self.limit, self.window = limit, window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


login_limiter = RateLimiter(10, 300)
booking_limiter = RateLimiter(20, 600)
forgot_limiter = RateLimiter(5, 900)
