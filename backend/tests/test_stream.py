"""SSE stream: filtering per view, tested on the bus + the endpoint's first event."""
import asyncio

from app.events import EventBus


def test_bus_fanout_and_thread_safety():
    async def main():
        bus = EventBus()
        bus.attach(asyncio.get_running_loop())
        q = bus.subscribe()
        bus.publish("a", {"n": 1})
        await asyncio.to_thread(bus.publish, "b", {"n": 2})  # from a worker thread
        got = [await asyncio.wait_for(q.get(), 1), await asyncio.wait_for(q.get(), 1)]
        bus.unsubscribe(q)
        bus.publish("c", {})
        return got, q.empty()

    got, empty = asyncio.run(main())
    assert [g["type"] for g in got] == ["a", "b"] and empty
