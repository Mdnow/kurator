import sqlite3
import os
import shutil
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), "notes.db")
BACKUP_DIR = os.path.join(os.path.dirname(__file__), "backups")


def _auto_backup():
    if not os.path.exists(DB_PATH):
        return
    conn = sqlite3.connect(DB_PATH)
    try:
        count = conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
    except Exception:
        count = 0
    conn.close()
    if count == 0:
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    dst = os.path.join(BACKUP_DIR, f"notes_{ts}.db")
    shutil.copy2(DB_PATH, dst)
    cutoff = datetime.now() - timedelta(days=7)
    for f in os.listdir(BACKUP_DIR):
        if f.startswith("notes_") and f.endswith(".db"):
            fp = os.path.join(BACKUP_DIR, f)
            try:
                ftime = datetime.fromtimestamp(os.path.getmtime(fp))
                if ftime < cutoff:
                    os.remove(fp)
            except Exception:
                pass


def _restore_if_empty():
    if not os.path.exists(DB_PATH):
        return
    conn = sqlite3.connect(DB_PATH)
    try:
        count = conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
    except Exception:
        count = -1
    conn.close()
    if count > 0:
        return
    if not os.path.exists(BACKUP_DIR):
        return
    backups = sorted(
        [f for f in os.listdir(BACKUP_DIR) if f.endswith(".db")],
        reverse=True,
    )
    if not backups:
        return
    latest = os.path.join(BACKUP_DIR, backups[0])
    shutil.copy2(latest, DB_PATH)


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    _restore_if_empty()
    _auto_backup()
    conn = get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            note_date TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.commit()

    # migration: add note_date to old tables
    try:
        conn.execute("ALTER TABLE notes ADD COLUMN note_date TEXT NOT NULL DEFAULT ''")
        conn.commit()
    except Exception:
        pass
    conn.close()


def add_note(content: str, note_date: str = "") -> dict:
    now = datetime.now().isoformat()
    if not note_date:
        note_date = datetime.now().strftime("%Y-%m-%d")
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO notes (content, note_date, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (content.strip(), note_date, now, now),
    )
    conn.commit()
    note = dict(
        conn.execute("SELECT * FROM notes WHERE id = ?", (cur.lastrowid,)).fetchone()
    )
    conn.close()
    return note


def get_all_notes() -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM notes ORDER BY note_date DESC, created_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_notes_by_date(date: str) -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM notes WHERE note_date = ? ORDER BY created_at DESC", (date,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_date_counts() -> dict[str, int]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT note_date, COUNT(*) as cnt FROM notes GROUP BY note_date ORDER BY note_date DESC"
    ).fetchall()
    conn.close()
    return {r["note_date"]: r["cnt"] for r in rows}


def update_note_date(note_id: int, note_date: str) -> bool:
    conn = get_conn()
    conn.execute("UPDATE notes SET note_date = ? WHERE id = ?", (note_date, note_id))
    conn.commit()
    conn.close()
    return True


def delete_note(note_id: int) -> bool:
    conn = get_conn()
    conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    conn.commit()
    deleted = conn.total_changes > 0
    conn.close()
    return deleted


def update_note(note_id: int, content: str) -> dict | None:
    now = datetime.now().isoformat()
    conn = get_conn()
    conn.execute(
        "UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
        (content.strip(), now, note_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


init_db()
