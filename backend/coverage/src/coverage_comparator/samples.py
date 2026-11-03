from typing import Protocol


class SampleSink(Protocol):
    """A database sink must make repeated writes with the same sample_id safe."""

    async def put(self, sample_id: str, sample: dict) -> None: ...


class MemorySampleSink:
    def __init__(self, limit: int = 1000):
        self.limit = limit
        self.samples: dict[str, dict] = {}

    async def put(self, sample_id: str, sample: dict) -> None:
        if sample_id in self.samples:
            return
        if len(self.samples) >= self.limit:
            self.samples.pop(next(iter(self.samples)))
        self.samples[sample_id] = sample


class DisabledSampleSink:
    async def put(self, sample_id: str, sample: dict) -> None:
        pass
