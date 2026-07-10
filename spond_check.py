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


def person_name(person_id, member_lookup):
    return member_lookup.get(person_id, person_id)


def build_member_lookup(group):
    lookup = {}

    if not group:
        return lookup

    for member in group.get("members", []):
        member_id = member.get("id")
        first = member.get("firstName", "") or ""
        last = member.get("lastName", "") or ""
        name = f"{first} {last}".strip()

        if member_id and name:
            lookup[member_id] = name

    return lookup


def extract_attendance(event, member_lookup):
    responses = event.get("responses", {})

    attending = [
        person_name(person_id, member_lookup)
        for person_id in responses.get("acceptedIds", [])
    ]

    declined = [
        person_name(person_id, member_lookup)
        for person_id in responses.get("declinedIds", [])
    ]

    unanswered = [
        person_name(person_id, member_lookup)
        for person_id in responses.get("unansweredIds", [])
    ]

    return {
        "attending": sorted(attending),
        "declined": sorted(declined),
        "unanswered": sorted(unanswered),
        "counts": {
            "attending": len(attending),
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

        target_group = next(
            (g for g in groups if g.get("name") == TARGET_GROUP_NAME),
            None,
        )

        # Scope to our own group — the Spond account behind SPOND_USERNAME/
        # SPOND_PASSWORD may belong to other Spond groups too (e.g. a
        # member's workplace team), and without group_id get_events()
        # returns events from every group that account is a member of.
        events = await s.get_events(
            max_events=50,
            group_id=target_group.get("id") if target_group else None,
        )

        member_lookup = build_member_lookup(target_group)
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
                **extract_attendance(next_event, member_lookup),
            }

        with open("upcoming-event.json", "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2, default=str)

        print(json.dumps(output, ensure_ascii=False, indent=2, default=str))

    finally:
        await s.clientsession.close()


asyncio.run(main())