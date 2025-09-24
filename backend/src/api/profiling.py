import os
import psutil
import logging
import tracemalloc
from functools import wraps
import gc
from fastapi import Request
import asyncio

logger = logging.getLogger("memory_tracker")
logger.propagate = False


def setup_memory_logging():
    logger.setLevel(logging.INFO)
    handler = logging.FileHandler("/var/log/holycluster_memory.log")
    handler.setFormatter(logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s"))
    logger.addHandler(handler)


class MemoryTracker:
    def __init__(self):
        self.process = psutil.Process(os.getpid())
        tracemalloc.start()

    def get_memory_usage(self):
        return self.process.memory_info().rss / 1024 / 1024

    def get_memory_snapshot(self):
        snapshot = tracemalloc.take_snapshot()
        top_stats = snapshot.statistics("lineno")
        return top_stats

    def log_memory_stats(self, context: str = ""):
        mem_usage = self.get_memory_usage()
        logger.info(f"Memory Usage [{context}]: {mem_usage:.2f} MB")

        top_stats = self.get_memory_snapshot()
        logger.info(f"Top 10 memory consumers [{context}]:")
        for stat in top_stats[:10]:
            logger.info(f"{stat.count} allocations: {stat.size / 1024 / 1024:.1f} MB")
            logger.info(f"  {stat.traceback.format()[0]}")


def track_endpoint_memory(func):
    @wraps(func)
    async def wrapper(*args, **kwargs):
        request = next((arg for arg in args if isinstance(arg, Request)), None)
        endpoint = request.url.path if request else func.__name__

        gc.collect()

        before_mem = psutil.Process(os.getpid()).memory_info().rss / 1024 / 1024
        logger.info(f"Endpoint {endpoint} - Starting memory: {before_mem:.2f} MB")

        result = await func(*args, **kwargs) if asyncio.iscoroutinefunction(func) else func(*args, **kwargs)

        gc.collect()

        after_mem = psutil.Process(os.getpid()).memory_info().rss / 1024 / 1024
        diff_mem = after_mem - before_mem
        logger.info(f"Endpoint {endpoint} - Ending memory: {after_mem:.2f} MB (Diff: {diff_mem:+.2f} MB)")

        return result

    return wrapper


memory_tracker = MemoryTracker()


def periodic_memory_check(app):
    async def memory_check():
        while True:
            try:
                memory_tracker.log_memory_stats("Periodic Check")
                if hasattr(app.state, "active_connections"):
                    logger.info(f"Active WebSocket connections: {len(app.state.active_connections)}")
                await asyncio.sleep(300)
            except Exception as e:
                logger.error(f"Error in memory check: {str(e)}")
                await asyncio.sleep(60)

    return memory_check
