"""
Kanban Board — Flask Hauptapplikation.

Stellt die Web-Oberflaeche bereit und definiert die REST-API
fuer Boards, Spalten und Karten. SQLite als Datenbank.

Starten mit: python app.py
"""

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

DB_PATH = Path(__file__).parent / "kanban.db"


# ── Datenbank ──────────────────────────────────────────────────────────

@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """Context Manager fuer Datenbankverbindungen mit Row-Factory."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Erstellt die Datenbanktabellen und Standard-Spalten."""
    with get_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS columns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS cards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                column_id INTEGER NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                label TEXT DEFAULT '',
                priority TEXT DEFAULT 'medium',
                due_date TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE
            )
        """)

        # Standard-Spalten anlegen falls leer
        existing = db.execute("SELECT COUNT(*) FROM columns").fetchone()[0]
        if existing == 0:
            for i, title in enumerate(["To Do", "In Progress", "Done"]):
                db.execute(
                    "INSERT INTO columns (title, position) VALUES (?, ?)",
                    (title, i),
                )


# ── Seiten-Routen ─────────────────────────────────────────────────────

@app.route("/")
def index():
    """Hauptseite mit dem Kanban Board."""
    return render_template("index.html")


# ── API: Spalten ───────────────────────────────────────────────────────

@app.route("/api/columns", methods=["GET"])
def get_columns():
    """Gibt alle Spalten mit ihren Karten zurueck."""
    with get_db() as db:
        columns = db.execute(
            "SELECT * FROM columns ORDER BY position"
        ).fetchall()

        result = []
        for col in columns:
            cards = db.execute(
                "SELECT * FROM cards WHERE column_id = ? ORDER BY position",
                (col["id"],),
            ).fetchall()

            result.append({
                "id": col["id"],
                "title": col["title"],
                "position": col["position"],
                "cards": [dict(c) for c in cards],
            })

    return jsonify(result)


@app.route("/api/columns", methods=["POST"])
def create_column():
    """Erstellt eine neue Spalte."""
    data = request.get_json()
    title = data.get("title", "").strip()

    if not title:
        return jsonify({"error": "Title is required"}), 400

    with get_db() as db:
        max_pos = db.execute("SELECT MAX(position) FROM columns").fetchone()[0]
        position = (max_pos or 0) + 1

        cursor = db.execute(
            "INSERT INTO columns (title, position) VALUES (?, ?)",
            (title, position),
        )

        return jsonify({"id": cursor.lastrowid, "title": title, "position": position}), 201


@app.route("/api/columns/<int:column_id>", methods=["DELETE"])
def delete_column(column_id: int):
    """Loescht eine Spalte und alle ihre Karten."""
    with get_db() as db:
        db.execute("DELETE FROM columns WHERE id = ?", (column_id,))
    return jsonify({"success": True})


@app.route("/api/columns/<int:column_id>", methods=["PUT"])
def update_column(column_id: int):
    """Aktualisiert den Titel einer Spalte."""
    data = request.get_json()
    title = data.get("title", "").strip()

    if not title:
        return jsonify({"error": "Title is required"}), 400

    with get_db() as db:
        db.execute("UPDATE columns SET title = ? WHERE id = ?", (title, column_id))
    return jsonify({"success": True})


# ── API: Karten ────────────────────────────────────────────────────────

@app.route("/api/cards", methods=["POST"])
def create_card():
    """Erstellt eine neue Karte in einer Spalte."""
    data = request.get_json()
    title = data.get("title", "").strip()
    column_id = data.get("column_id")

    if not title or not column_id:
        return jsonify({"error": "Title and column_id are required"}), 400

    with get_db() as db:
        max_pos = db.execute(
            "SELECT MAX(position) FROM cards WHERE column_id = ?", (column_id,)
        ).fetchone()[0]
        position = (max_pos or 0) + 1

        cursor = db.execute(
            """INSERT INTO cards (title, description, column_id, position, label, priority, due_date)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                title,
                data.get("description", ""),
                column_id,
                position,
                data.get("label", ""),
                data.get("priority", "medium"),
                data.get("due_date", ""),
            ),
        )

        card = db.execute("SELECT * FROM cards WHERE id = ?", (cursor.lastrowid,)).fetchone()
        return jsonify(dict(card)), 201


@app.route("/api/cards/<int:card_id>", methods=["PUT"])
def update_card(card_id: int):
    """Aktualisiert eine Karte."""
    data = request.get_json()

    with get_db() as db:
        card = db.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        if not card:
            return jsonify({"error": "Card not found"}), 404

        db.execute(
            """UPDATE cards SET title = ?, description = ?, label = ?, priority = ?, due_date = ?
               WHERE id = ?""",
            (
                data.get("title", card["title"]),
                data.get("description", card["description"]),
                data.get("label", card["label"]),
                data.get("priority", card["priority"]),
                data.get("due_date", card["due_date"]),
                card_id,
            ),
        )

    return jsonify({"success": True})


@app.route("/api/cards/<int:card_id>", methods=["DELETE"])
def delete_card(card_id: int):
    """Loescht eine Karte."""
    with get_db() as db:
        db.execute("DELETE FROM cards WHERE id = ?", (card_id,))
    return jsonify({"success": True})


@app.route("/api/cards/move", methods=["PUT"])
def move_card():
    """
    Verschiebt eine Karte in eine andere Spalte und/oder Position.

    Erwartet: card_id, target_column_id, target_position
    """
    data = request.get_json()
    card_id = data.get("card_id")
    target_column_id = data.get("target_column_id")
    target_position = data.get("target_position", 0)

    if not card_id or not target_column_id:
        return jsonify({"error": "card_id and target_column_id are required"}), 400

    with get_db() as db:
        db.execute(
            """UPDATE cards SET position = position + 1
               WHERE column_id = ? AND position >= ?""",
            (target_column_id, target_position),
        )

        db.execute(
            "UPDATE cards SET column_id = ?, position = ? WHERE id = ?",
            (target_column_id, target_position, card_id),
        )

    return jsonify({"success": True})


# ── API: Statistiken ──────────────────────────────────────────────────

@app.route("/api/stats", methods=["GET"])
def get_stats():
    """Gibt Board-Statistiken zurueck fuer das Stats-Panel."""
    with get_db() as db:
        total = db.execute("SELECT COUNT(*) FROM cards").fetchone()[0]

        # Karten pro Spalte
        per_column = db.execute("""
            SELECT c.title, COUNT(cards.id) as count
            FROM columns c
            LEFT JOIN cards ON cards.column_id = c.id
            GROUP BY c.id
            ORDER BY c.position
        """).fetchall()

        # Nach Prioritaet
        per_priority = db.execute("""
            SELECT priority, COUNT(*) as count
            FROM cards GROUP BY priority
        """).fetchall()

        # Ueberfaellige
        overdue = db.execute("""
            SELECT COUNT(*) FROM cards
            WHERE due_date != '' AND due_date < date('now')
            AND column_id != (SELECT id FROM columns ORDER BY position DESC LIMIT 1)
        """).fetchone()[0]

    return jsonify({
        "total": total,
        "per_column": [{"title": r["title"], "count": r["count"]} for r in per_column],
        "per_priority": {r["priority"]: r["count"] for r in per_priority},
        "overdue": overdue,
    })


# ── Start ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    app.run(debug=True, port=5000)
