#!/usr/bin/env python3

import argparse
import json
import os
import re
import sqlite3
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def json_dumps(value):
    return json.dumps(value, ensure_ascii=True)


def parse_json(body):
    if not body:
        return {}
    return json.loads(body.decode("utf-8"))


def split_ids(raw):
    if not isinstance(raw, list):
        raise ValueError("Expected a list.")
    values = []
    seen = set()
    for item in raw:
        if not isinstance(item, str):
            raise ValueError("All IDs must be strings.")
        cleaned = item.strip()
        if not cleaned:
            raise ValueError("IDs cannot be empty.")
        if cleaned in seen:
            raise ValueError(f"Duplicate ID '{cleaned}'.")
        values.append(cleaned)
        seen.add(cleaned)
    return values


def normalize_name(value):
    if not isinstance(value, str):
        raise ValueError("Name must be a string.")
    cleaned = " ".join(value.split()).strip()
    if not cleaned:
        raise ValueError("Name cannot be empty.")
    return cleaned


def slugify(value):
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "participant"


def build_rank_positions(rankings):
    return {
        entity_id: {choice_id: index for index, choice_id in enumerate(choice_ids)}
        for entity_id, choice_ids in rankings.items()
    }


def summarize_outcome(code):
    labels = {
        "accepted": "accepted",
        "accepted_replace": "accepted and displaced an incumbent",
        "rejected_unranked": "rejected because the receiver did not rank the proposer",
        "rejected_capacity": "rejected because the receiver had no capacity",
        "rejected_preference": "rejected because the receiver preferred its current hold(s)",
    }
    return labels.get(code, code)


def average(values):
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def find_blocking_pairs(hospitals, candidates, hospital_rankings, candidate_rankings, hospital_matches):
    hospital_caps = {item["id"]: item["capacity"] for item in hospitals}
    candidate_match = {}
    for hospital_id, candidate_ids in hospital_matches.items():
        for candidate_id in candidate_ids:
            candidate_match[candidate_id] = hospital_id

    hospital_positions = build_rank_positions(hospital_rankings)
    candidate_positions = build_rank_positions(candidate_rankings)
    candidate_name = {item["id"]: item["name"] for item in candidates}
    hospital_name = {item["id"]: item["name"] for item in hospitals}
    pairs = []

    for hospital in hospitals:
        hospital_id = hospital["id"]
        ranked_candidates = hospital_positions.get(hospital_id, {})
        matched_candidates = hospital_matches.get(hospital_id, [])
        open_slot = len(matched_candidates) < hospital_caps[hospital_id]
        worst_current = None
        worst_rank = None
        if matched_candidates:
            worst_current = max(
                matched_candidates,
                key=lambda candidate_id: ranked_candidates.get(candidate_id, float("inf")),
            )
            worst_rank = ranked_candidates.get(worst_current, float("inf"))

        for candidate in candidates:
            candidate_id = candidate["id"]
            if candidate_id in matched_candidates:
                continue

            if candidate_id not in ranked_candidates:
                continue

            candidate_ranks = candidate_positions.get(candidate_id, {})
            if hospital_id not in candidate_ranks:
                continue

            current_hospital = candidate_match.get(candidate_id)
            current_rank = (
                candidate_ranks.get(current_hospital, float("inf"))
                if current_hospital is not None
                else float("inf")
            )
            candidate_prefers_hospital = current_hospital is None or candidate_ranks[hospital_id] < current_rank
            if not candidate_prefers_hospital:
                continue

            hospital_prefers_candidate = open_slot or ranked_candidates[candidate_id] < worst_rank
            if not hospital_prefers_candidate:
                continue

            pairs.append(
                {
                    "hospitalId": hospital_id,
                    "hospitalName": hospital_name[hospital_id],
                    "candidateId": candidate_id,
                    "candidateName": candidate_name[candidate_id],
                }
            )

    return pairs


def compute_stats(hospitals, candidates, hospital_rankings, candidate_rankings, hospital_matches):
    candidate_match = {}
    for hospital_id, candidate_ids in hospital_matches.items():
        for candidate_id in candidate_ids:
            candidate_match[candidate_id] = hospital_id

    candidate_positions = build_rank_positions(candidate_rankings)
    hospital_positions = build_rank_positions(hospital_rankings)

    candidate_ranks = []
    for candidate in candidates:
        candidate_id = candidate["id"]
        hospital_id = candidate_match.get(candidate_id)
        if hospital_id is None:
            continue
        position = candidate_positions.get(candidate_id, {}).get(hospital_id)
        if position is not None:
            candidate_ranks.append(position + 1)

    hospital_ranks = []
    for hospital in hospitals:
        hospital_id = hospital["id"]
        for candidate_id in hospital_matches.get(hospital_id, []):
            position = hospital_positions.get(hospital_id, {}).get(candidate_id)
            if position is not None:
                hospital_ranks.append(position + 1)

    blocking_pairs = find_blocking_pairs(
        hospitals,
        candidates,
        hospital_rankings,
        candidate_rankings,
        hospital_matches,
    )

    total_slots = sum(item["capacity"] for item in hospitals)
    matched_count = sum(len(candidate_ids) for candidate_ids in hospital_matches.values())

    return {
        "matchedCount": matched_count,
        "candidateCount": len(candidates),
        "totalSlots": total_slots,
        "averageCandidateRank": average(candidate_ranks),
        "averageHospitalRank": average(hospital_ranks),
        "blockingPairs": blocking_pairs,
        "isStable": len(blocking_pairs) == 0,
    }


def deferred_acceptance(proposers, proposer_capacities, proposer_rankings, receivers, receiver_capacities, receiver_rankings):
    proposer_matches = {proposer_id: [] for proposer_id in proposers}
    receiver_holds = {receiver_id: [] for receiver_id in receivers}
    next_choice = {proposer_id: 0 for proposer_id in proposers}
    receiver_positions = build_rank_positions(receiver_rankings)
    free = deque(
        [
            proposer_id
            for proposer_id in proposers
            if proposer_capacities.get(proposer_id, 0) > 0 and proposer_rankings.get(proposer_id)
        ]
    )
    trace = []
    step = 1

    while free:
        proposer_id = free.popleft()
        while (
            len(proposer_matches[proposer_id]) < proposer_capacities.get(proposer_id, 0)
            and next_choice[proposer_id] < len(proposer_rankings.get(proposer_id, []))
        ):
            receiver_id = proposer_rankings[proposer_id][next_choice[proposer_id]]
            next_choice[proposer_id] += 1
            event = {
                "step": step,
                "proposerId": proposer_id,
                "receiverId": receiver_id,
                "outcome": None,
                "displacedProposerId": None,
            }

            receiver_capacity = receiver_capacities.get(receiver_id, 0)
            receiver_order = receiver_positions.get(receiver_id, {})
            if receiver_capacity <= 0:
                event["outcome"] = "rejected_capacity"
            elif proposer_id not in receiver_order:
                event["outcome"] = "rejected_unranked"
            else:
                held = receiver_holds[receiver_id]
                if len(held) < receiver_capacity:
                    held.append(proposer_id)
                    proposer_matches[proposer_id].append(receiver_id)
                    event["outcome"] = "accepted"
                else:
                    worst_current = max(
                        held,
                        key=lambda current_id: receiver_order.get(current_id, float("inf")),
                    )
                    if receiver_order[proposer_id] < receiver_order.get(worst_current, float("inf")):
                        held.remove(worst_current)
                        proposer_matches[worst_current].remove(receiver_id)
                        held.append(proposer_id)
                        proposer_matches[proposer_id].append(receiver_id)
                        event["outcome"] = "accepted_replace"
                        event["displacedProposerId"] = worst_current
                        if (
                            len(proposer_matches[worst_current]) < proposer_capacities.get(worst_current, 0)
                            and next_choice[worst_current] < len(proposer_rankings.get(worst_current, []))
                        ):
                            free.append(worst_current)
                    else:
                        event["outcome"] = "rejected_preference"

            trace.append(event)
            step += 1

    return proposer_matches, receiver_holds, trace


def run_matching(hospitals, candidates, hospital_rankings, candidate_rankings, proposer_side):
    hospital_ids = [item["id"] for item in hospitals]
    candidate_ids = [item["id"] for item in candidates]
    hospital_caps = {item["id"]: item["capacity"] for item in hospitals}

    if proposer_side == "hospital":
        proposer_matches, receiver_holds, trace = deferred_acceptance(
            proposers=hospital_ids,
            proposer_capacities=hospital_caps,
            proposer_rankings=hospital_rankings,
            receivers=candidate_ids,
            receiver_capacities={candidate_id: 1 for candidate_id in candidate_ids},
            receiver_rankings=candidate_rankings,
        )
        hospital_matches = {hospital_id: sorted(candidate_ids) for hospital_id, candidate_ids in proposer_matches.items()}
        candidate_matches = {
            candidate_id: (receiver_holds[candidate_id][0] if receiver_holds[candidate_id] else None)
            for candidate_id in candidate_ids
        }
    elif proposer_side == "candidate":
        proposer_matches, receiver_holds, trace = deferred_acceptance(
            proposers=candidate_ids,
            proposer_capacities={candidate_id: 1 for candidate_id in candidate_ids},
            proposer_rankings=candidate_rankings,
            receivers=hospital_ids,
            receiver_capacities=hospital_caps,
            receiver_rankings=hospital_rankings,
        )
        hospital_matches = {hospital_id: sorted(candidate_ids) for hospital_id, candidate_ids in receiver_holds.items()}
        candidate_matches = {
            candidate_id: (proposer_matches[candidate_id][0] if proposer_matches[candidate_id] else None)
            for candidate_id in candidate_ids
        }
    else:
        raise ValueError("proposerSide must be 'hospital' or 'candidate'.")

    stats = compute_stats(
        hospitals=hospitals,
        candidates=candidates,
        hospital_rankings=hospital_rankings,
        candidate_rankings=candidate_rankings,
        hospital_matches=hospital_matches,
    )

    hospital_name = {item["id"]: item["name"] for item in hospitals}
    candidate_name = {item["id"]: item["name"] for item in candidates}
    named_trace = []
    for event in trace:
        named_trace.append(
            {
                **event,
                "proposerName": hospital_name.get(event["proposerId"], candidate_name.get(event["proposerId"], event["proposerId"])),
                "receiverName": hospital_name.get(event["receiverId"], candidate_name.get(event["receiverId"], event["receiverId"])),
                "displacedProposerName": hospital_name.get(
                    event["displacedProposerId"],
                    candidate_name.get(event["displacedProposerId"], event["displacedProposerId"]),
                )
                if event["displacedProposerId"]
                else None,
                "outcomeLabel": summarize_outcome(event["outcome"]),
            }
        )

    return {
        "createdAt": utc_now(),
        "proposerSide": proposer_side,
        "hospitalMatches": hospital_matches,
        "candidateMatches": candidate_matches,
        "trace": named_trace,
        "stats": stats,
    }


class MatchingStore:
    def __init__(self, db_path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self):
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self):
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS hospitals (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    capacity INTEGER NOT NULL CHECK (capacity >= 0)
                );

                CREATE TABLE IF NOT EXISTS candidates (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS hospital_rankings (
                    hospital_id TEXT NOT NULL,
                    candidate_id TEXT NOT NULL,
                    rank_index INTEGER NOT NULL,
                    PRIMARY KEY (hospital_id, candidate_id),
                    UNIQUE (hospital_id, rank_index)
                );

                CREATE TABLE IF NOT EXISTS candidate_rankings (
                    candidate_id TEXT NOT NULL,
                    hospital_id TEXT NOT NULL,
                    rank_index INTEGER NOT NULL,
                    PRIMARY KEY (candidate_id, hospital_id),
                    UNIQUE (candidate_id, rank_index)
                );

                CREATE TABLE IF NOT EXISTS runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    proposer_side TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS submissions (
                    role_type TEXT NOT NULL CHECK (role_type IN ('hospital', 'candidate')),
                    role_id TEXT NOT NULL,
                    submitted_at TEXT NOT NULL,
                    source TEXT NOT NULL,
                    PRIMARY KEY (role_type, role_id)
                );
                """
            )

    def _invalidate_runs(self, connection):
        connection.execute("DELETE FROM runs")

    def _set_submission(self, connection, role_type, role_id, source):
        connection.execute(
            """
            INSERT INTO submissions (role_type, role_id, submitted_at, source)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(role_type, role_id) DO UPDATE SET
                submitted_at = excluded.submitted_at,
                source = excluded.source
            """,
            (role_type, role_id, utc_now(), source),
        )

    def _clear_submission(self, connection, role_type, role_id):
        connection.execute(
            "DELETE FROM submissions WHERE role_type = ? AND role_id = ?",
            (role_type, role_id),
        )

    def _load_hospitals(self, connection):
        return [
            dict(row)
            for row in connection.execute(
                "SELECT id, name, capacity FROM hospitals ORDER BY id"
            ).fetchall()
        ]

    def _load_candidates(self, connection):
        return [
            dict(row)
            for row in connection.execute(
                "SELECT id, name FROM candidates ORDER BY id"
            ).fetchall()
        ]

    def _load_rankings(self, connection, table_name, owner_column, choice_column):
        rankings = {}
        for row in connection.execute(
            f"""
            SELECT {owner_column} AS owner_id, {choice_column} AS choice_id
            FROM {table_name}
            ORDER BY {owner_column}, rank_index
            """
        ).fetchall():
            rankings.setdefault(row["owner_id"], []).append(row["choice_id"])
        return rankings

    def _load_submissions(self, connection):
        submissions = {"hospital": {}, "candidate": {}}
        for row in connection.execute(
            "SELECT role_type, role_id, submitted_at, source FROM submissions"
        ).fetchall():
            submissions[row["role_type"]][row["role_id"]] = {
                "submittedAt": row["submitted_at"],
                "source": row["source"],
            }
        return submissions

    def _latest_run(self, connection):
        latest_row = connection.execute(
            "SELECT payload_json FROM runs ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return json.loads(latest_row["payload_json"]) if latest_row else None

    def _find_role_by_name(self, connection, role_type, name):
        if role_type == "hospital":
            return connection.execute(
                """
                SELECT id, name, capacity
                FROM hospitals
                WHERE lower(name) = lower(?)
                ORDER BY id
                LIMIT 1
                """,
                (name,),
            ).fetchone()
        if role_type == "candidate":
            return connection.execute(
                """
                SELECT id, name
                FROM candidates
                WHERE lower(name) = lower(?)
                ORDER BY id
                LIMIT 1
                """,
                (name,),
            ).fetchone()
        raise ValueError("roleType must be 'hospital' or 'candidate'.")

    def _next_available_id(self, connection, table_name, base_id):
        candidate_id = base_id
        suffix = 2
        while connection.execute(
            f"SELECT 1 FROM {table_name} WHERE id = ?",
            (candidate_id,),
        ).fetchone():
            candidate_id = f"{base_id}-{suffix}"
            suffix += 1
        return candidate_id

    def _build_submission_summary(self, hospitals, candidates, hospital_rankings, candidate_rankings, submissions):
        hospital_statuses = []
        for hospital in hospitals:
            ranking = hospital_rankings.get(hospital["id"], [])
            metadata = submissions["hospital"].get(hospital["id"])
            submitted = bool(metadata) or bool(ranking)
            hospital_statuses.append(
                {
                    "id": hospital["id"],
                    "name": hospital["name"],
                    "capacity": hospital["capacity"],
                    "submitted": submitted,
                    "submittedAt": metadata["submittedAt"] if metadata else None,
                    "source": metadata["source"] if metadata else ("legacy" if ranking else None),
                    "rankingCount": len(ranking),
                    "requiredCount": len(candidates),
                }
            )

        candidate_statuses = []
        for candidate in candidates:
            ranking = candidate_rankings.get(candidate["id"], [])
            metadata = submissions["candidate"].get(candidate["id"])
            submitted = bool(metadata) or bool(ranking)
            candidate_statuses.append(
                {
                    "id": candidate["id"],
                    "name": candidate["name"],
                    "submitted": submitted,
                    "submittedAt": metadata["submittedAt"] if metadata else None,
                    "source": metadata["source"] if metadata else ("legacy" if ranking else None),
                    "rankingCount": len(ranking),
                    "requiredCount": len(hospitals),
                }
            )

        return {
            "hospitals": hospital_statuses,
            "candidates": candidate_statuses,
            "counts": {
                "hospitalsSubmitted": sum(1 for item in hospital_statuses if item["submitted"]),
                "hospitalsTotal": len(hospital_statuses),
                "candidatesSubmitted": sum(1 for item in candidate_statuses if item["submitted"]),
                "candidatesTotal": len(candidate_statuses),
            },
        }

    def export_state(self):
        with self._connect() as connection:
            hospitals = self._load_hospitals(connection)
            candidates = self._load_candidates(connection)
            hospital_rankings = self._load_rankings(
                connection,
                table_name="hospital_rankings",
                owner_column="hospital_id",
                choice_column="candidate_id",
            )
            candidate_rankings = self._load_rankings(
                connection,
                table_name="candidate_rankings",
                owner_column="candidate_id",
                choice_column="hospital_id",
            )
            submissions = self._load_submissions(connection)
            latest_run = self._latest_run(connection)
            submission_summary = self._build_submission_summary(
                hospitals,
                candidates,
                hospital_rankings,
                candidate_rankings,
                submissions,
            )

        return {
            "hospitals": hospitals,
            "candidates": candidates,
            "hospitalRankings": hospital_rankings,
            "candidateRankings": candidate_rankings,
            "submissionSummary": submission_summary,
            "latestRun": latest_run,
        }

    def export_public_market(self):
        with self._connect() as connection:
            hospitals = self._load_hospitals(connection)
            candidates = self._load_candidates(connection)
            hospital_rankings = self._load_rankings(
                connection,
                table_name="hospital_rankings",
                owner_column="hospital_id",
                choice_column="candidate_id",
            )
            candidate_rankings = self._load_rankings(
                connection,
                table_name="candidate_rankings",
                owner_column="candidate_id",
                choice_column="hospital_id",
            )
            submissions = self._load_submissions(connection)
            submission_summary = self._build_submission_summary(
                hospitals,
                candidates,
                hospital_rankings,
                candidate_rankings,
                submissions,
            )
            latest_run = self._latest_run(connection)

        return {
            "hospitals": hospitals,
            "candidates": candidates,
            "submissionCounts": submission_summary["counts"],
            "hasRun": latest_run is not None,
        }

    def export_public_role(self, role_type, role_id):
        if role_type not in {"hospital", "candidate"}:
            raise ValueError("roleType must be 'hospital' or 'candidate'.")

        with self._connect() as connection:
            submissions = self._load_submissions(connection)
            if role_type == "hospital":
                row = connection.execute(
                    "SELECT id, name, capacity FROM hospitals WHERE id = ?",
                    (role_id,),
                ).fetchone()
                if row is None:
                    raise ValueError(f"Unknown hospital '{role_id}'.")
                ranking = self._load_rankings(
                    connection,
                    table_name="hospital_rankings",
                    owner_column="hospital_id",
                    choice_column="candidate_id",
                ).get(role_id, [])
                choices = self._load_candidates(connection)
            else:
                row = connection.execute(
                    "SELECT id, name FROM candidates WHERE id = ?",
                    (role_id,),
                ).fetchone()
                if row is None:
                    raise ValueError(f"Unknown candidate '{role_id}'.")
                ranking = self._load_rankings(
                    connection,
                    table_name="candidate_rankings",
                    owner_column="candidate_id",
                    choice_column="hospital_id",
                ).get(role_id, [])
                choices = self._load_hospitals(connection)

            metadata = submissions[role_type].get(role_id)

        return {
            "roleType": role_type,
            "role": dict(row),
            "choices": choices,
            "currentRanking": ranking,
            "submittedAt": metadata["submittedAt"] if metadata else None,
            "source": metadata["source"] if metadata else ("legacy" if ranking else None),
        }

    def register_public_role(self, role_type, name, capacity=1):
        role_type = str(role_type).strip().lower()
        name = normalize_name(name)

        if role_type == "hospital":
            try:
                capacity = int(capacity)
            except (TypeError, ValueError):
                raise ValueError("Hospital capacity must be an integer.")
            if capacity < 1:
                raise ValueError("Hospital capacity must be at least 1.")
        elif role_type != "candidate":
            raise ValueError("roleType must be 'hospital' or 'candidate'.")

        with self._connect() as connection:
            existing = self._find_role_by_name(connection, role_type, name)
            created = False
            if existing is not None:
                role_id = existing["id"]
            elif role_type == "hospital":
                role_id = self._next_available_id(connection, "hospitals", slugify(name))
                connection.execute(
                    "INSERT INTO hospitals (id, name, capacity) VALUES (?, ?, ?)",
                    (role_id, name, capacity),
                )
                self._invalidate_runs(connection)
                created = True
            else:
                role_id = self._next_available_id(connection, "candidates", slugify(name))
                connection.execute(
                    "INSERT INTO candidates (id, name) VALUES (?, ?)",
                    (role_id, name),
                )
                self._invalidate_runs(connection)
                created = True

        payload = self.export_public_role(role_type, role_id)
        payload["created"] = created
        return payload

    def upsert_hospital(self, hospital_id, name, capacity):
        if not isinstance(capacity, int) or capacity < 0:
            raise ValueError("Hospital capacity must be a non-negative integer.")
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO hospitals (id, name, capacity)
                VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, capacity = excluded.capacity
                """,
                (hospital_id, name, capacity),
            )
            self._invalidate_runs(connection)

    def upsert_candidate(self, candidate_id, name):
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO candidates (id, name)
                VALUES (?, ?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name
                """,
                (candidate_id, name),
            )
            self._invalidate_runs(connection)

    def _assert_entities_exist(self, connection, table_name, entity_ids):
        if not entity_ids:
            return
        placeholders = ",".join("?" for _ in entity_ids)
        rows = connection.execute(
            f"SELECT id FROM {table_name} WHERE id IN ({placeholders})",
            tuple(entity_ids),
        ).fetchall()
        existing = {row["id"] for row in rows}
        missing = [entity_id for entity_id in entity_ids if entity_id not in existing]
        if missing:
            raise ValueError(f"Unknown IDs in {table_name}: {', '.join(missing)}")

    def set_hospital_ranking(self, hospital_id, candidate_ids, source="admin"):
        candidate_ids = split_ids(candidate_ids)
        with self._connect() as connection:
            self._assert_entities_exist(connection, "hospitals", [hospital_id])
            self._assert_entities_exist(connection, "candidates", candidate_ids)
            connection.execute("DELETE FROM hospital_rankings WHERE hospital_id = ?", (hospital_id,))
            connection.executemany(
                """
                INSERT INTO hospital_rankings (hospital_id, candidate_id, rank_index)
                VALUES (?, ?, ?)
                """,
                [(hospital_id, candidate_id, index) for index, candidate_id in enumerate(candidate_ids)],
            )
            if candidate_ids:
                self._set_submission(connection, "hospital", hospital_id, source)
            else:
                self._clear_submission(connection, "hospital", hospital_id)
            self._invalidate_runs(connection)

    def set_candidate_ranking(self, candidate_id, hospital_ids, source="admin"):
        hospital_ids = split_ids(hospital_ids)
        with self._connect() as connection:
            self._assert_entities_exist(connection, "candidates", [candidate_id])
            self._assert_entities_exist(connection, "hospitals", hospital_ids)
            connection.execute("DELETE FROM candidate_rankings WHERE candidate_id = ?", (candidate_id,))
            connection.executemany(
                """
                INSERT INTO candidate_rankings (candidate_id, hospital_id, rank_index)
                VALUES (?, ?, ?)
                """,
                [(candidate_id, hospital_id, index) for index, hospital_id in enumerate(hospital_ids)],
            )
            if hospital_ids:
                self._set_submission(connection, "candidate", candidate_id, source)
            else:
                self._clear_submission(connection, "candidate", candidate_id)
            self._invalidate_runs(connection)

    def replace_state(self, payload):
        hospitals = payload.get("hospitals", [])
        candidates = payload.get("candidates", [])
        hospital_rankings = payload.get("hospitalRankings", {})
        candidate_rankings = payload.get("candidateRankings", {})

        if not isinstance(hospitals, list) or not isinstance(candidates, list):
            raise ValueError("hospitals and candidates must be arrays.")
        if not isinstance(hospital_rankings, dict) or not isinstance(candidate_rankings, dict):
            raise ValueError("Ranking maps must be objects.")

        with self._connect() as connection:
            connection.execute("DELETE FROM hospital_rankings")
            connection.execute("DELETE FROM candidate_rankings")
            connection.execute("DELETE FROM submissions")
            connection.execute("DELETE FROM hospitals")
            connection.execute("DELETE FROM candidates")
            self._invalidate_runs(connection)

            for hospital in hospitals:
                hospital_id = str(hospital["id"]).strip()
                name = str(hospital["name"]).strip()
                capacity = int(hospital["capacity"])
                if not hospital_id or not name:
                    raise ValueError("Hospitals require non-empty id and name.")
                connection.execute(
                    "INSERT INTO hospitals (id, name, capacity) VALUES (?, ?, ?)",
                    (hospital_id, name, capacity),
                )

            for candidate in candidates:
                candidate_id = str(candidate["id"]).strip()
                name = str(candidate["name"]).strip()
                if not candidate_id or not name:
                    raise ValueError("Candidates require non-empty id and name.")
                connection.execute(
                    "INSERT INTO candidates (id, name) VALUES (?, ?)",
                    (candidate_id, name),
                )

            self._assert_entities_exist(connection, "hospitals", list(hospital_rankings.keys()))
            self._assert_entities_exist(connection, "candidates", list(candidate_rankings.keys()))

            for hospital_id, ranked_candidates in hospital_rankings.items():
                values = split_ids(ranked_candidates)
                self._assert_entities_exist(connection, "candidates", values)
                connection.executemany(
                    """
                    INSERT INTO hospital_rankings (hospital_id, candidate_id, rank_index)
                    VALUES (?, ?, ?)
                    """,
                    [(hospital_id, candidate_id, index) for index, candidate_id in enumerate(values)],
                )
                if values:
                    self._set_submission(connection, "hospital", hospital_id, "import")

            for candidate_id, ranked_hospitals in candidate_rankings.items():
                values = split_ids(ranked_hospitals)
                self._assert_entities_exist(connection, "hospitals", values)
                connection.executemany(
                    """
                    INSERT INTO candidate_rankings (candidate_id, hospital_id, rank_index)
                    VALUES (?, ?, ?)
                    """,
                    [(candidate_id, hospital_id, index) for index, hospital_id in enumerate(values)],
                )
                if values:
                    self._set_submission(connection, "candidate", candidate_id, "import")
            self._invalidate_runs(connection)

    def reset(self):
        with self._connect() as connection:
            connection.execute("DELETE FROM hospital_rankings")
            connection.execute("DELETE FROM candidate_rankings")
            connection.execute("DELETE FROM submissions")
            connection.execute("DELETE FROM hospitals")
            connection.execute("DELETE FROM candidates")
            connection.execute("DELETE FROM runs")

    def load_demo(self):
        self.reset()
        self.replace_state(
            {
                "hospitals": [
                    {"id": "hopkins", "name": "Hopkins", "capacity": 1},
                    {"id": "stanford", "name": "Stanford", "capacity": 1},
                    {"id": "yale", "name": "Yale", "capacity": 1},
                ],
                "candidates": [
                    {"id": "alice", "name": "Alice", "capacity": 1},
                    {"id": "barbara", "name": "Barbara", "capacity": 1},
                    {"id": "charlie", "name": "Charlie", "capacity": 1},
                ],
                "hospitalRankings": {
                    "hopkins": ["alice", "barbara", "charlie"],
                    "stanford": ["alice", "barbara", "charlie"],
                    "yale": ["barbara", "alice", "charlie"],
                },
                "candidateRankings": {
                    "alice": ["yale", "stanford", "hopkins"],
                    "barbara": ["stanford", "yale", "hopkins"],
                    "charlie": ["stanford", "yale", "hopkins"],
                },
            }
        )

    def submit_participant_ranking(self, role_type, role_id, ordered_ids):
        ordered_ids = split_ids(ordered_ids)
        if not ordered_ids:
            raise ValueError("Submit at least one ranked preference.")
        if role_type == "hospital":
            self.set_hospital_ranking(role_id, ordered_ids, source="participant")
        elif role_type == "candidate":
            self.set_candidate_ranking(role_id, ordered_ids, source="participant")
        else:
            raise ValueError("roleType must be 'hospital' or 'candidate'.")
        return self.export_public_role(role_type, role_id)

    def run(self, proposer_side):
        state = self.export_state()
        result = run_matching(
            hospitals=state["hospitals"],
            candidates=state["candidates"],
            hospital_rankings=state["hospitalRankings"],
            candidate_rankings=state["candidateRankings"],
            proposer_side=proposer_side,
        )
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO runs (created_at, proposer_side, payload_json)
                VALUES (?, ?, ?)
                """,
                (result["createdAt"], proposer_side, json_dumps(result)),
            )
        return result


class MatchingApplication:
    def __init__(self, store, admin_key=None, allowed_origin="*"):
        self.store = store
        self.admin_key = admin_key
        self.allowed_origin = allowed_origin


class MatchingHandler(BaseHTTPRequestHandler):
    server_version = "MatchingDashboard/0.1"

    @property
    def app(self):
        return self.server.app

    def do_OPTIONS(self):
        self.send_response(204)
        self._write_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/health":
                self._respond_json({"ok": True, "time": utc_now()})
                return
            if parsed.path == "/api/state":
                self._require_admin()
                self._respond_json(self.app.store.export_state())
                return
            if parsed.path == "/api/public/market":
                self._respond_json(self.app.store.export_public_market())
                return
            if parsed.path == "/api/public/role":
                query = parse_qs(parsed.query)
                role_type = query.get("roleType", [""])[0].strip().lower()
                role_id = query.get("roleId", [""])[0].strip()
                self._respond_json(self.app.store.export_public_role(role_type, role_id))
                return
            self._respond_json({"error": "Not found."}, status=404)
        except ValueError as exc:
            self._respond_json({"error": str(exc)}, status=400)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            body = parse_json(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            if parsed.path == "/api/admin/reset":
                self._require_admin()
                self.app.store.reset()
                self._respond_json(self.app.store.export_state())
                return
            if parsed.path == "/api/admin/load-demo":
                self._require_admin()
                self.app.store.load_demo()
                self._respond_json(self.app.store.export_state())
                return
            if parsed.path == "/api/public/register":
                role_type = str(body.get("roleType", "")).strip().lower()
                name = body.get("name", "")
                capacity = body.get("capacity", 1)
                payload = self.app.store.register_public_role(role_type, name, capacity)
                self._respond_json(payload)
                return
            if parsed.path == "/api/public/submit":
                role_type = str(body.get("roleType", "")).strip().lower()
                role_id = str(body.get("roleId", "")).strip()
                payload = self.app.store.submit_participant_ranking(
                    role_type,
                    role_id,
                    body.get("orderedIds", []),
                )
                self._respond_json(payload)
                return
            if parsed.path == "/api/import":
                self._require_admin()
                self.app.store.replace_state(body)
                self._respond_json(self.app.store.export_state())
                return
            if parsed.path == "/api/hospitals":
                self._require_admin()
                hospital_id = str(body.get("id", "")).strip()
                name = str(body.get("name", "")).strip()
                capacity = int(body.get("capacity", 0))
                if not hospital_id or not name:
                    raise ValueError("Hospital requires non-empty id and name.")
                self.app.store.upsert_hospital(hospital_id, name, capacity)
                self._respond_json(self.app.store.export_state())
                return
            if parsed.path == "/api/candidates":
                self._require_admin()
                candidate_id = str(body.get("id", "")).strip()
                name = str(body.get("name", "")).strip()
                if not candidate_id or not name:
                    raise ValueError("Candidate requires non-empty id and name.")
                self.app.store.upsert_candidate(candidate_id, name)
                self._respond_json(self.app.store.export_state())
                return
            if parsed.path == "/api/rankings/hospital":
                self._require_admin()
                hospital_id = str(body.get("hospitalId", "")).strip()
                self.app.store.set_hospital_ranking(hospital_id, body.get("orderedCandidateIds", []))
                self._respond_json(self.app.store.export_state())
                return
            if parsed.path == "/api/rankings/candidate":
                self._require_admin()
                candidate_id = str(body.get("candidateId", "")).strip()
                self.app.store.set_candidate_ranking(candidate_id, body.get("orderedHospitalIds", []))
                self._respond_json(self.app.store.export_state())
                return
            if parsed.path == "/api/run":
                self._require_admin()
                proposer_side = str(body.get("proposerSide", "hospital")).strip().lower()
                result = self.app.store.run(proposer_side)
                self._respond_json(result)
                return
            self._respond_json({"error": "Not found."}, status=404)
        except ValueError as exc:
            self._respond_json({"error": str(exc)}, status=400)
        except json.JSONDecodeError:
            self._respond_json({"error": "Body must be valid JSON."}, status=400)

    def log_message(self, format_string, *args):
        return

    def _require_admin(self):
        if self.app.admin_key and self.headers.get("X-Admin-Key") != self.app.admin_key:
            raise ValueError("Missing or invalid admin key.")

    def _write_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", self.app.allowed_origin)
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _respond_json(self, payload, status=200):
        body = json_dumps(payload).encode("utf-8")
        self.send_response(status)
        self._write_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    default_db_path = Path(__file__).with_name("data").joinpath("matching.db")
    parser = argparse.ArgumentParser(description="Matching dashboard backend")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", default=8787, type=int)
    parser.add_argument(
        "--db-path",
        default=os.environ.get("MATCHING_DB_PATH", str(default_db_path)),
    )
    parser.add_argument(
        "--allowed-origin",
        default=os.environ.get("MATCHING_ALLOWED_ORIGIN", "*"),
    )
    parser.add_argument(
        "--admin-key",
        default=os.environ.get("MATCHING_ADMIN_KEY"),
    )
    args = parser.parse_args()

    store = MatchingStore(args.db_path)
    app = MatchingApplication(
        store=store,
        admin_key=args.admin_key,
        allowed_origin=args.allowed_origin,
    )
    server = ThreadingHTTPServer((args.host, args.port), MatchingHandler)
    server.app = app
    print(f"Matching dashboard backend listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
