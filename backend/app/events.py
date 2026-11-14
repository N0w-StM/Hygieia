"""In-process event bus feeding the SSE stream. publish() is safe from any thread."""
from __future__ import annotations

import asyncio


class EventBus:
    def __init__(self):
        self._subs: set[asyncio.Queue] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def attach(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop

    def _fanout(self, event: dict):
        for q in list(self._subs):
            if q.full():  # slow client: drop its oldest event rather than block everyone
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(event)

    def publish(self, type_: str, data: dict):
        event = {"type": type_, "data": data}
        if self._loop is None or self._loop.is_closed():
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is self._loop:
            self._fanout(event)
        else:
            self._loop.call_soon_threadsafe(self._fanout, event)

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        self._subs.discard(q)
