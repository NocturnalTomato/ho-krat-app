import asyncio
import os
import json
from datetime import datetime, timezone
from spond import spond


TARGET_GROUP_NAME = "Groen Geel - H8"


def parse_dt(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def is_relevant_event(event):
    name = event.get("heading", "").lower()
    return (
        "training" in name
        or "thuis" in name
        or "uit" in name
        or "td" in name
    )


def get_event_type(event):
    name = event.get("heading", "").lower()
    if "training" in name:
        return "training"
    if "td" in name:
        return "td"
    return "wedstrijd"


def full_name(person):
    first = person.get("firstName", "") or ""
    last = person.get("lastName", "") or ""
    return f"{first} {last}".strip() or "Unknown"


def extract_attendance(event):
    accepted = []
    declined = []
    unanswered = []

    responses = event.get("responses", {})

    for status, people in responses.items():
        for person in people:
            name = full_name(person)

            if status.lower() in ["accepted", "attending", "yes"]:
                accepted.append(name)
            elif status.lower() in ["declined", "not_attending", "no"]:
                declined.append(name)
            else:
                unanswered.append(name)

    return {
        "attending": sorted(accepted),
        "declined": sorted(declined),
        "unanswered": sorted(unanswered),
        "counts": {
            "attending": len(accepted),
            "declined": len(declined),
            "unanswered": len(unanswered),
        },
    }


async def main():
    username = os.environ["SPOND_USERNAME"]
    password = os.environ["SPOND_PASSWORD"]

    s = spond.Spond(username=username, password=password)

    try:
        groups = await s.get_groups()
        events = await s.get_events(max_events=50)

        target_group = next(
            (g for g in groups if g.get("name") == TARGET_GROUP_NAME),
            None,
        )

        now = datetime.now(timezone.utc)

        relevant_events = [
            event for event in events
            if event.get("startTimestamp")
            and is_relevant_event(event)
            and parse_dt(event["startTimestamp"]) > now
        ]

        relevant_events.sort(key=lambda e: parse_dt(e["startTimestamp"]))

        next_event = relevant_events[0] if relevant_events else None

        output = {
            "updatedAt": now.isoformat(),
            "team": TARGET_GROUP_NAME,
            "groupId": target_group.get("id") if target_group else None,
            "memberCount": len(target_group.get("members", [])) if target_group else None,
            "upcomingEvent": None,
        }

        if next_event:
            output["upcomingEvent"] = {
                "id": next_event.get("id"),
                "name": next_event.get("heading"),
                "startTimestamp": next_event.get("startTimestamp"),
                "endTimestamp": next_event.get("endTimestamp"),
                "location": next_event.get("location"),
                "type": get_event_type(next_event),
                **extract_attendance(next_event),
            }

        with open("upcoming-event.json", "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2, default=str)

        print(json.dumps(output, ensure_ascii=False, indent=2, default=str))

    finally:
        await s.clientsession.close()


asyncio.run(main())