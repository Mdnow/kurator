from __future__ import annotations

import math
import re
from collections import Counter


def _tokenize(text: str) -> list[str]:
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    return [t for t in text.split() if len(t) > 1]


def _cosine_sim(a: dict[str, float], b: dict[str, float]) -> float:
    keys = set(a) & set(b)
    if not keys:
        return 0.0
    dot = sum(a[k] * b[k] for k in keys)
    norm_a = math.sqrt(sum(v * v for v in a.values()))
    norm_b = math.sqrt(sum(v * v for v in b.values()))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _tfidf_vectors(corpus: list[str]) -> list[dict[str, float]]:
    tokenized = [_tokenize(c) for c in corpus]
    n_docs = len(corpus)
    doc_freq: Counter[str] = Counter()
    for tokens in tokenized:
        for t in set(tokens):
            doc_freq[t] += 1

    vectors = []
    for tokens in tokenized:
        tf = Counter(tokens)
        vec = {}
        for word, count in tf.items():
            idf = math.log((n_docs + 1) / (doc_freq[word] + 1)) + 1
            vec[word] = count * idf
        vectors.append(vec)
    return vectors


def _union_find_cluster(
    n: int, sim_matrix: list[list[float]], threshold: float
) -> list[int]:
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: int, y: int):
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[rx] = ry

    for i in range(n):
        for j in range(i + 1, n):
            if sim_matrix[i][j] >= threshold:
                union(i, j)

    root_map: dict[int, int] = {}
    labels = []
    for i in range(n):
        r = find(i)
        if r not in root_map:
            root_map[r] = len(root_map)
        labels.append(root_map[r])
    return labels


def cluster_notes(notes: list[dict], threshold: float = 0.12) -> dict[str, list[dict]]:
    if len(notes) <= 1:
        return {"Все заметки": list(notes)} if notes else {}

    corpus = [n["content"] for n in notes]
    vectors = _tfidf_vectors(corpus)
    n = len(notes)

    sim_matrix = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            s = _cosine_sim(vectors[i], vectors[j])
            sim_matrix[i][j] = s
            sim_matrix[j][i] = s

    labels = _union_find_cluster(n, sim_matrix, threshold)

    groups: dict[int, list[dict]] = {}
    for idx, label in enumerate(labels):
        groups.setdefault(label, []).append(notes[idx])

    named: dict[str, list[dict]] = {}
    for label, items in groups.items():
        if len(items) == 1:
            words = items[0]["content"][:40].split()
            title = " ".join(words[:4])
            if len(items[0]["content"]) > 40:
                title += "..."
        else:
            centroid: Counter[str] = Counter()
            for item in items:
                for token in _tokenize(item["content"]):
                    centroid[token] += 1
            top = [w for w, _ in centroid.most_common(3)]
            title = " / ".join(top[:2]).capitalize() if top else "Группа"

        named[title] = items

    return dict(sorted(named.items(), key=lambda x: -len(x[1])))


def find_similar(query: str, notes: list[dict], top_k: int = 2) -> list[dict]:
    if not notes:
        return []
    corpus = [query] + [n["content"] for n in notes]
    vectors = _tfidf_vectors(corpus)
    q_vec = vectors[0]
    results = []
    for i, note in enumerate(notes):
        sim = _cosine_sim(q_vec, vectors[i + 1])
        if sim > 0.05:
            results.append(
                {"id": note["id"], "content": note["content"], "score": round(sim, 3)}
            )
    results.sort(key=lambda x: -x["score"])
    return results[:top_k]
