import asyncio
import os
import json
from spond import spond


async def main():
    username = os.environ["SPOND_USERNAME"]
    password = os.environ["SPOND_PASSWORD"]

    s = spond(username=username, password=password)

    try:
        groups = await s.get_groups()
        events = await s.get_events(max_events=20)

        print(f"GROUPS: {len(groups)}")
        for group in groups:
            print(f"- {group.get('name')} | id={group.get('id')}")

        print("\nEVENTS:")
        for event in events:
            print(f"- {event.get('heading')} | {event.get('startTimestamp')}")

        with open("spond_output.json", "w", encoding="utf-8") as f:
            json.dump(
                {"groups": groups, "events": events},
                f,
                ensure_ascii=False,
                indent=2,
                default=str,
            )

    finally:
        await s.clientsession.close()


asyncio.run(main())