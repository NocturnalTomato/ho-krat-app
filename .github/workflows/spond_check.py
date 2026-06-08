import asyncio
import os
import json
from spond import Spond


async def main():
    username = os.environ["SPOND_USERNAME"]
    password = os.environ["SPOND_PASSWORD"]

    s = Spond(username=username, password=password)

    try:
        groups = await s.get_groups()
        events = await s.get_events(max_events=20)

        print(f"GROUPS: {len(groups)}")
        for group in groups:
            print(f"- {group.get('name')} | id={group.get('id')}")

            members = group.get("members", [])
            print(f"  members: {len(members)}")
            for member in members[:10]:
                first = member.get("firstName", "")
                last = member.get("lastName", "")
                print(f"    - {first} {last}".strip())

        print("\nEVENTS:")
        for event in events:
            print(
                f"- {event.get('heading')} | "
                f"{event.get('startTimestamp')} | "
                f"id={event.get('id')}"
            )

        with open("spond_output.json", "w", encoding="utf-8") as f:
            json.dump(
                {
                    "groups": groups,
                    "events": events,
                },
                f,
                ensure_ascii=False,
                indent=2,
                default=str,
            )

    finally:
        await s.clientsession.close()


if __name__ == "__main__":
    asyncio.run(main())