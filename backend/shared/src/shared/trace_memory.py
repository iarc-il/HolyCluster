import asyncio
import tracemalloc

tracemalloc.start()


async def tracemalloc_task():
    prev_snapshot = None
    while True:
        snapshot = tracemalloc.take_snapshot()
        snapshot = snapshot.filter_traces((
            tracemalloc.Filter(False, "<frozen importlib._bootstrap>"),
            tracemalloc.Filter(False, "<unknown>"),
        ))

        top_stats = snapshot.statistics("lineno")

        print("[ Top 20 ]")
        for stat in top_stats[:20]:
            print(stat)

        if prev_snapshot is not None:
            print("\n\n[ Top 10 differences ]")
            top_stats = snapshot.compare_to(prev_snapshot, "lineno")
            for stat in top_stats[:10]:
                print(stat)

        await asyncio.sleep(60)
        prev_snapshot = snapshot
