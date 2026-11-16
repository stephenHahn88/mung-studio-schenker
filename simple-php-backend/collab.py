"""Real-time collaboration hub for MuNG Studio.

Per document, in memory: an ordered operation log, SSE subscriber queues (one per connected browser) and presence
sessions (name, colour, cursor, selection). Clients save the whole mung.xml; each save clears the operation log, so
a joining client loads mung.xml and replays the operations made since the last save. The server does not parse the
graph.
"""
import itertools
import queue
import threading
import time

STALE_AFTER = 15.0          # drop a presence session unseen for this many seconds
OPLOG_CAP = 8000            # hard cap; compacted to half when exceeded
PING_INTERVAL = 15.0        # SSE keepalive comment cadence


class CollabHub:
    def __init__(self):
        self._lock = threading.Lock()
        self._docs = {}                 # doc -> state dict
        self._subids = itertools.count(1)

    def _doc(self, doc):
        d = self._docs.get(doc)
        if d is None:
            d = {"seq": 0, "oplog": [], "subs": {}, "sessions": {}}
            self._docs[doc] = d
        return d

    # ---- SSE subscribers -------------------------------------------------
    def subscribe(self, doc):
        q = queue.Queue()
        with self._lock:
            d = self._doc(doc)
            sid = next(self._subids)
            d["subs"][sid] = q
        return sid, q

    def unsubscribe(self, doc, sid, client_id=None):
        with self._lock:
            d = self._docs.get(doc)
            if not d:
                return
            d["subs"].pop(sid, None)
            if client_id:
                d["sessions"].pop(client_id, None)
            users = self._presence_locked(d)
        self._broadcast(doc, {"type": "presence", "users": users})

    def _broadcast(self, doc, event):
        with self._lock:
            d = self._docs.get(doc)
            qs = list(d["subs"].values()) if d else []
        for q in qs:
            try:
                q.put_nowait(event)
            except Exception:
                pass

    # ---- operations ------------------------------------------------------
    def push_op(self, doc, op, client_id):
        with self._lock:
            d = self._doc(doc)
            d["seq"] += 1
            seq = d["seq"]
            d["oplog"].append((seq, client_id, op))
            if len(d["oplog"]) > OPLOG_CAP:
                d["oplog"] = d["oplog"][-(OPLOG_CAP // 2):]
        self._broadcast(doc, {"type": "op", "seq": seq, "clientId": client_id, "op": op})
        return seq

    def clear_oplog(self, doc):
        """Clear the operation log after a full-document save."""
        with self._lock:
            d = self._docs.get(doc)
            if d:
                d["oplog"] = []

    # ---- presence --------------------------------------------------------
    def presence(self, doc, client_id, info):
        with self._lock:
            d = self._doc(doc)
            s = d["sessions"].get(client_id, {})
            s.update(info)
            s["clientId"] = client_id
            s["lastSeen"] = time.time()
            d["sessions"][client_id] = s
            users = self._presence_locked(d)
        self._broadcast(doc, {"type": "presence", "users": users})

    def _presence_locked(self, d):
        now = time.time()
        stale = [cid for cid, s in d["sessions"].items()
                 if now - s.get("lastSeen", 0) > STALE_AFTER]
        for cid in stale:
            d["sessions"].pop(cid, None)
        return [{k: v for k, v in s.items() if k != "lastSeen"}
                for s in d["sessions"].values()]

    # ---- snapshot for a new joiner --------------------------------------
    def snapshot(self, doc):
        with self._lock:
            d = self._doc(doc)
            oplog = [{"seq": seq, "clientId": cid, "op": op}
                     for (seq, cid, op) in d["oplog"]]
            return d["seq"], oplog, self._presence_locked(d)


HUB = CollabHub()
