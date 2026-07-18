import webbrowser
import threading
from flask import Flask, render_template, request, jsonify
from database import (
    add_note,
    get_all_notes,
    get_notes_by_date,
    get_date_counts,
    delete_note,
    update_note,
)
from clustering import cluster_notes, find_similar

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/notes", methods=["GET"])
def api_get_notes():
    date = request.args.get("date")
    if date:
        notes = get_notes_by_date(date)
    else:
        notes = get_all_notes()
    groups = cluster_notes(notes)
    date_counts = get_date_counts()
    return jsonify({"notes": notes, "groups": groups, "date_counts": date_counts})


@app.route("/api/notes", methods=["POST"])
def api_add_note():
    data = request.get_json()
    content = (data.get("content") or "").strip()
    note_date = (data.get("date") or "").strip()
    if not content:
        return jsonify({"error": "Пустая заметка"}), 400
    note = add_note(content, note_date)
    return jsonify(note), 201


@app.route("/api/notes/<int:note_id>", methods=["DELETE"])
def api_delete_note(note_id):
    ok = delete_note(note_id)
    if not ok:
        return jsonify({"error": "Не найдено"}), 404
    return jsonify({"ok": True})


@app.route("/api/notes/<int:note_id>", methods=["PUT"])
def api_update_note(note_id):
    data = request.get_json()
    content = (data.get("content") or "").strip()
    if not content:
        return jsonify({"error": "Пустая заметка"}), 400
    note = update_note(note_id, content)
    if not note:
        return jsonify({"error": "Не найдено"}), 404
    return jsonify(note)


@app.route("/api/similar", methods=["GET"])
def api_similar():
    text = request.args.get("q", "").strip()
    if len(text) < 3:
        return jsonify([])
    all_notes = get_all_notes()
    matches = find_similar(text, all_notes, top_k=2)
    return jsonify(matches)


@app.route("/api/yesterday", methods=["GET"])
def api_yesterday():
    from datetime import datetime, timedelta

    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    notes = get_notes_by_date(yesterday)
    if not notes:
        return jsonify({"has": False})
    groups = cluster_notes(notes)
    return jsonify(
        {
            "has": True,
            "count": len(notes),
            "groups": len(groups),
            "date": yesterday,
        }
    )


def open_browser():
    webbrowser.open("http://127.0.0.1:5555")


if __name__ == "__main__":
    threading.Timer(1.0, open_browser).start()
    app.run(host="127.0.0.1", port=5555, debug=False)
